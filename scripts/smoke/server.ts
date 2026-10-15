import { readdirSync, readFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

// Process and readiness helpers for the smoke's next start server.

const POLL_INTERVAL_MS = 250;
const HEALTH_REQUEST_TIMEOUT_MS = 2000;

// A port the OS just handed out on 127.0.0.1. Another process could take it
// before next start binds it; that shows up as a readiness failure with the
// server log, never as a silent fallback.
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close((error) => (error === undefined ? resolve(port) : reject(error)));
    });
  });
}

export interface WaitForHealthyOptions {
  deadlineMs: number;
  // Non-null once the server process has exited: waiting further is pointless.
  exitCode: () => number | string | null;
}

// Polls the URL until it answers 200, the server exits or the deadline passes.
export async function waitForHealthy(url: string, { deadlineMs, exitCode }: WaitForHealthyOptions): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let lastResult = "no answer yet";
  while (Date.now() < deadline) {
    const exited = exitCode();
    if (exited !== null) {
      throw new Error(`the server exited (${exited}) before ${url} answered 200`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS) });
      await response.body?.cancel();
      if (response.status === 200) {
        return;
      }
      lastResult = `status ${response.status}`;
    } catch (error) {
      lastResult = error instanceof Error ? error.message : String(error);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${url} did not answer 200 within ${deadlineMs} ms (last: ${lastResult})`);
}

// On Linux, whether any member of the group is something other than a zombie.
// A process whose parent has exited is reaped by PID 1, and a container's PID 1
// may never do that; such a zombie still answers kill(-pgid, 0) but runs
// nothing and holds no port. null where /proc is not available.
function hasLiveGroupMember(pgid: number): boolean | null {
  let pids: string[];
  try {
    pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return null;
  }
  return pids.some((pid) => {
    let stat: string;
    try {
      stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    } catch {
      return false;
    }
    // "pid (comm) state ppid pgrp ..."; comm may itself contain ") ".
    const [state, , pgrp] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return Number(pgrp) === pgid && state !== "Z";
  });
}

export function isProcessGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    throw error;
  }
  return hasLiveGroupMember(pgid) ?? true;
}

function signalProcessGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

async function waitForGroupExit(pgid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessGroupAlive(pgid)) {
    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(50);
  }
  return true;
}

export interface StopProcessGroupOptions {
  graceMs: number;
  killWaitMs: number;
}

// Stops every process in the group the server leads (next start and the
// workers it forks), not just the leader: SIGTERM, then SIGKILL after the
// grace period. Throws if anything in the group is still alive afterwards.
export async function stopProcessGroup(
  pgid: number,
  { graceMs, killWaitMs }: StopProcessGroupOptions = { graceMs: 10_000, killWaitMs: 5000 },
): Promise<void> {
  signalProcessGroup(pgid, "SIGTERM");
  if (await waitForGroupExit(pgid, graceMs)) {
    return;
  }
  signalProcessGroup(pgid, "SIGKILL");
  if (!(await waitForGroupExit(pgid, killWaitMs))) {
    throw new Error(`process group ${pgid} is still running after SIGKILL`);
  }
}

// The last lines of the server log, for a failure message.
export function readLogTail(path: string, lines: number): string {
  try {
    return readFileSync(path, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch (error) {
    return `(server log unreadable: ${error instanceof Error ? error.message : String(error)})`;
  }
}
