import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { hashAdminPassword } from "../../src/admin/password.ts";
import { findFreePort, readLogTail, stopProcessGroup, waitForHealthy } from "./server.ts";
import { assertReadyOrderStored, createSmokeDatabase } from "./smoke-database.ts";
import { buildPlaywrightEnv, buildServerEnv, smokePaths } from "./smoke-env.ts";
import { generateSelfSignedCertificate, startTlsProxy, type TlsProxy } from "./tls-proxy.ts";

// Usage: npm run smoke:run (after npm run build), or npm run smoke to build first.
//
// Runs the Playwright smoke against the local production build: a fresh
// SQLite file and a random admin account in a temporary directory, next start
// on 127.0.0.1 in its own process group, and a TLS proxy on 127.0.0.1 in front
// of it. Everything is stopped and the directory removed on every exit path.
// The admin password and hash are never printed.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const NEXT_BIN = join(ROOT, "node_modules", "next", "dist", "bin", "next");
const PLAYWRIGHT_CLI = join(ROOT, "node_modules", "@playwright", "test", "cli.js");
const PLAYWRIGHT_CONFIG = join(ROOT, "playwright.config.ts");
const BUILD_ID = join(ROOT, ".next", "BUILD_ID");

const STARTUP_DEADLINE_MS = 60_000;
const PLAYWRIGHT_STOP_GRACE_MS = 10_000;
const LOG_TAIL_LINES = 40;

interface Resources {
  dir?: string;
  serverLogPath?: string;
  server?: ChildProcess;
  proxy?: TlsProxy;
  playwright?: ChildProcess;
}

const resources: Resources = {};

function log(message: string): void {
  console.log(`smoke: ${message}`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function printServerLogTail(): void {
  if (resources.serverLogPath !== undefined) {
    console.error(`smoke: last ${LOG_TAIL_LINES} lines of the next start log:\n${readLogTail(resources.serverLogPath, LOG_TAIL_LINES)}`);
  }
}

function runPlaywright(env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, "test", "--config", PLAYWRIGHT_CONFIG], {
      cwd: ROOT,
      env,
      stdio: "inherit",
    });
    resources.playwright = child;
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function run(): Promise<number> {
  if (!existsSync(BUILD_ID)) {
    throw new Error(".next/BUILD_ID is missing: run npm run build first, or use npm run smoke, which builds");
  }
  for (const path of [NEXT_BIN, PLAYWRIGHT_CLI]) {
    if (!existsSync(path)) {
      throw new Error(`${path} is missing: run npm ci`);
    }
  }

  const dir = mkdtempSync(join(tmpdir(), "coffy-smoke-"));
  resources.dir = dir;
  const paths = smokePaths(dir);
  resources.serverLogPath = paths.serverLogPath;
  createSmokeDatabase(paths.databasePath);
  generateSelfSignedCertificate(paths.keyPath, paths.certPath);

  const adminUsername = `smoke-${randomBytes(6).toString("hex")}`;
  const adminPassword = randomBytes(32).toString("base64url");
  const adminPasswordHash = await hashAdminPassword(adminPassword);

  const appPort = await findFreePort();
  const logFd = openSync(paths.serverLogPath, "a");
  let server: ChildProcess;
  try {
    // detached: next start leads its own process group, so stopping the group
    // also stops the workers it forks.
    server = spawn(process.execPath, [NEXT_BIN, "start", "--hostname", "127.0.0.1", "--port", String(appPort)], {
      cwd: ROOT,
      env: buildServerEnv({ databasePath: paths.databasePath, adminUsername, adminPasswordHash, inherited: process.env }),
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
  } finally {
    closeSync(logFd);
  }
  resources.server = server;
  server.once("error", (error) => console.error(`smoke: next start could not be started: ${error.message}`));
  log(`next start on 127.0.0.1:${appPort} with a fresh database in ${dir}`);

  try {
    await waitForHealthy(`http://127.0.0.1:${appPort}/api/health`, {
      deadlineMs: STARTUP_DEADLINE_MS,
      exitCode: () => server.exitCode ?? server.signalCode,
    });
  } catch (error) {
    printServerLogTail();
    throw error;
  }

  const proxy = await startTlsProxy({
    key: readFileSync(paths.keyPath),
    cert: readFileSync(paths.certPath),
    upstreamPort: appPort,
  });
  resources.proxy = proxy;
  const baseUrl = `https://127.0.0.1:${proxy.port}`;
  log(`running Playwright against ${baseUrl}`);

  const code = await runPlaywright(
    buildPlaywrightEnv({ baseUrl, adminUsername, adminPassword, inherited: process.env }),
  );
  if (code !== 0) {
    printServerLogTail();
    return code;
  }
  assertReadyOrderStored(paths.databasePath);
  return 0;
}

async function stopPlaywright(child: ChildProcess): Promise<void> {
  child.kill("SIGTERM");
  const deadline = Date.now() + PLAYWRIGHT_STOP_GRACE_MS;
  while (isRunning(child) && Date.now() < deadline) {
    await sleep(50);
  }
  if (isRunning(child)) {
    child.kill("SIGKILL");
  }
}

let cleanupResult: Promise<boolean> | null = null;

// Idempotent: the normal path and a signal handler may both call it. Each step
// runs even when an earlier one failed; false when any of them failed.
function cleanup(): Promise<boolean> {
  cleanupResult ??= (async () => {
    let ok = true;
    const step = async (name: string, work: () => void | Promise<void>) => {
      try {
        await work();
      } catch (error) {
        ok = false;
        console.error(`smoke: cleanup could not ${name}: ${describeError(error)}`);
      }
    };
    const { playwright, proxy, server, dir } = resources;
    if (playwright !== undefined && isRunning(playwright)) {
      await step("stop Playwright", () => stopPlaywright(playwright));
    }
    if (proxy !== undefined) {
      await step("close the TLS proxy", () => proxy.close());
    }
    if (server?.pid !== undefined) {
      const pid = server.pid;
      await step("stop the next start process group", () => stopProcessGroup(pid));
    }
    if (dir !== undefined) {
      await step(`remove ${dir}`, () => rmSync(dir, { recursive: true, force: true }));
    }
    if (ok) {
      log("cleanup complete: nothing left running, temporary directory removed");
    }
    return ok;
  })();
  return cleanupResult;
}

let signalled = false;
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.on(signal, () => {
    if (signalled) {
      return;
    }
    signalled = true;
    console.error(`smoke: ${signal} received, cleaning up`);
    void cleanup().then(() => process.exit(code));
  });
}

let exitCode: number;
try {
  exitCode = await run();
} catch (error) {
  console.error(`smoke failed: ${describeError(error)}`);
  exitCode = 1;
}
const cleanedUp = await cleanup();
process.exitCode = exitCode === 0 && !cleanedUp ? 1 : exitCode;
