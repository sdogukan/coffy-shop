import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type IncomingHttpHeaders, type Server } from "node:http";
import { request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { changeOrderStatus } from "../../src/db/admin-orders.ts";
import { DATABASE_PATH_ENV, openDatabase } from "../../src/db/connection.ts";
import { listMigrations } from "../../src/db/migrate.ts";
import { PRODUCT_FIXTURES } from "../../src/db/catalog.ts";
import { createOrder } from "../../src/db/orders.ts";
import { parseOrderRequest } from "../../src/orders/order-request.ts";
import { isProcessGroupAlive, stopProcessGroup, waitForHealthy } from "../../scripts/smoke/server.ts";
import { assertReadyOrderStored, createSmokeDatabase } from "../../scripts/smoke/smoke-database.ts";
import {
  buildPlaywrightEnv,
  buildServerEnv,
  buildUpstreamHeaders,
  parseSmokeBaseUrl,
  SMOKE_ADMIN_PASSWORD_ENV,
  SMOKE_ADMIN_USERNAME_ENV,
  SMOKE_BASE_URL_ENV,
  smokePaths,
} from "../../scripts/smoke/smoke-env.ts";
import { generateSelfSignedCertificate, startTlsProxy, type TlsProxy } from "../../scripts/smoke/tls-proxy.ts";

// What a developer's shell may export: the live database, the Demo URL and a
// real admin account. None of it may reach the smoke server or the specs.
const HOSTILE_SHELL = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/dev",
  NODE_ENV: "development",
  PLAYWRIGHT_BROWSERS_PATH: "/opt/ms-playwright",
  COFFY_DATABASE_PATH: "/var/lib/coffy-shop/data/coffy.sqlite",
  COFFY_APP_URL: "https://coffy.52-29-95-160.sslip.io",
  COFFY_ADMIN_USERNAME: "live-admin",
  COFFY_ADMIN_PASSWORD_HASH: "scrypt.32768.8.1.live.hash",
  COFFY_E2E_ADMIN_PASSWORD: "live-password",
  COFFY_SMOKE_BASE_URL: "https://coffy.52-29-95-160.sslip.io",
  AWS_SECRET_ACCESS_KEY: "do-not-pass",
};

describe("smoke base URL", () => {
  it.each(["https://127.0.0.1:4443", "https://127.0.0.1:4443/", "https://127.0.0.2:4443", "https://[::1]:8443"])(
    "accepts the loopback https URL %s",
    (value) => {
      expect(parseSmokeBaseUrl(value)).toBe(new URL(value).origin);
    },
  );

  it.each([
    ["missing", undefined],
    ["empty", " "],
    ["not a URL", "127.0.0.1:4443"],
    ["plain http", "http://127.0.0.1:4443"],
    ["the Demo URL (COFFY_APP_URL)", "https://coffy.52-29-95-160.sslip.io"],
    ["a private network address", "https://10.0.0.5:4443"],
    ["localhost, which the resolver decides", "https://localhost:4443"],
    ["a name that starts like a loopback address", "https://127.0.0.1.sslip.io:4443"],
    ["no explicit port", "https://127.0.0.1"],
    ["credentials", "https://user:secret@127.0.0.1:4443"],
    ["a path", "https://127.0.0.1:4443/yonetim"],
    ["a query", "https://127.0.0.1:4443/?next=x"],
  ])("refuses %s", (_name, value) => {
    expect(() => parseSmokeBaseUrl(value)).toThrow(SMOKE_BASE_URL_ENV);
  });
});

describe("smoke environments", () => {
  it("builds the server env from scratch: only PATH and HOME come from the shell", () => {
    expect(
      buildServerEnv({
        databasePath: "/tmp/coffy-smoke-x/coffy.sqlite",
        adminUsername: "smoke-abc",
        adminPasswordHash: "scrypt.smoke.hash",
        inherited: HOSTILE_SHELL,
      }),
    ).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/home/dev",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      COFFY_DATABASE_PATH: "/tmp/coffy-smoke-x/coffy.sqlite",
      COFFY_ADMIN_USERNAME: "smoke-abc",
      COFFY_ADMIN_PASSWORD_HASH: "scrypt.smoke.hash",
    });
  });

  it("gives Playwright the smoke values and no COFFY_* value from the shell", () => {
    const env = buildPlaywrightEnv({
      baseUrl: "https://127.0.0.1:4443",
      adminUsername: "smoke-abc",
      adminPassword: "smoke-password",
      inherited: HOSTILE_SHELL,
    });
    expect(Object.keys(env).filter((name) => name.startsWith("COFFY_")).sort()).toEqual(
      [SMOKE_ADMIN_PASSWORD_ENV, SMOKE_ADMIN_USERNAME_ENV, SMOKE_BASE_URL_ENV].sort(),
    );
    expect(env).toMatchObject({
      [SMOKE_BASE_URL_ENV]: "https://127.0.0.1:4443",
      [SMOKE_ADMIN_USERNAME_ENV]: "smoke-abc",
      [SMOKE_ADMIN_PASSWORD_ENV]: "smoke-password",
      NODE_ENV: "test",
      PLAYWRIGHT_BROWSERS_PATH: "/opt/ms-playwright",
    });
  });

  it("refuses to hand Playwright a non-loopback base URL", () => {
    expect(() =>
      buildPlaywrightEnv({
        baseUrl: HOSTILE_SHELL.COFFY_APP_URL,
        adminUsername: "smoke-abc",
        adminPassword: "smoke-password",
        inherited: {},
      }),
    ).toThrow(SMOKE_BASE_URL_ENV);
  });

  it("keeps every file the smoke writes inside its temporary directory", () => {
    const dir = "/tmp/coffy-smoke-abc";
    for (const path of Object.values(smokePaths(dir))) {
      expect(dirname(path)).toBe(dir);
    }
  });
});

describe("upstream headers", () => {
  it("keeps Host, drops hop-by-hop headers and replaces client X-Forwarded-* values", () => {
    const incoming: IncomingHttpHeaders = {
      host: "127.0.0.1:4443",
      origin: "https://127.0.0.1:4443",
      cookie: "coffy_admin_session=abc",
      connection: "keep-alive, x-private",
      "keep-alive": "timeout=5",
      "x-private": "1",
      "transfer-encoding": "chunked",
      "x-forwarded-proto": "http",
      "x-forwarded-host": "evil.example",
      "x-forwarded-for": "203.0.113.9",
    };
    expect(buildUpstreamHeaders(incoming, "127.0.0.1")).toEqual({
      host: "127.0.0.1:4443",
      origin: "https://127.0.0.1:4443",
      cookie: "coffy_admin_session=abc",
      "x-forwarded-for": "127.0.0.1",
      "x-forwarded-host": "127.0.0.1:4443",
      "x-forwarded-proto": "https",
    });
  });
});

interface ProxiedReply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function requestThroughProxy(port: number, host: string, body: string): Promise<ProxiedReply> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      { host: "127.0.0.1", port, method: "POST", path: "/api/orders?x=1", rejectUnauthorized: false, headers: { host, "content-type": "application/json" } },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (text += chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text }));
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

describe("TLS proxy", () => {
  let dir: string;
  let upstream: Server;
  let proxy: TlsProxy;
  let seen: { method?: string; url?: string; headers: IncomingHttpHeaders; body: string } | null = null;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "coffy-smoke-test-"));
    const paths = smokePaths(dir);
    generateSelfSignedCertificate(paths.keyPath, paths.certPath);
    upstream = createHttpServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => (body += chunk));
      request.on("end", () => {
        seen = { method: request.method, url: request.url, headers: request.headers, body };
        response.writeHead(201, { "Set-Cookie": ["a=1; Secure", "b=2; Secure"], "Content-Type": "application/json" });
        response.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    proxy = await startTlsProxy({
      key: readFileSync(paths.keyPath),
      cert: readFileSync(paths.certPath),
      upstreamPort: (upstream.address() as AddressInfo).port,
    });
  });

  afterAll(async () => {
    await proxy.close();
    upstream.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("forwards method, path, body and the Host header unchanged, and returns every Set-Cookie", async () => {
    const reply = await requestThroughProxy(proxy.port, "127.0.0.1:4443", '{"a":1}');
    expect(seen).toMatchObject({ method: "POST", url: "/api/orders?x=1", body: '{"a":1}' });
    expect(seen?.headers).toMatchObject({ host: "127.0.0.1:4443", "x-forwarded-proto": "https" });
    expect(reply).toMatchObject({ status: 201, body: '{"ok":true}' });
    expect(reply.headers["set-cookie"]).toEqual(["a=1; Secure", "b=2; Secure"]);
  });

  it("answers 502 when the app is not reachable", async () => {
    const closed = await startTlsProxy({
      key: readFileSync(smokePaths(dir).keyPath),
      cert: readFileSync(smokePaths(dir).certPath),
      upstreamPort: 1,
    });
    try {
      expect((await requestThroughProxy(closed.port, "127.0.0.1:4443", "")).status).toBe(502);
    } finally {
      await closed.close();
    }
  });

  it("names openssl when it is not installed", () => {
    const path = process.env.PATH;
    process.env.PATH = dir;
    try {
      expect(() => generateSelfSignedCertificate(join(dir, "k.pem"), join(dir, "c.pem"))).toThrow(/openssl was not found/);
    } finally {
      process.env.PATH = path;
    }
  });
});

describe("next start process group", () => {
  const started: ChildProcess[] = [];

  afterEach(() => {
    for (const child of started.splice(0)) {
      if (child.pid !== undefined && isProcessGroupAlive(child.pid)) {
        process.kill(-child.pid, "SIGKILL");
      }
    }
  });

  // A detached leader that forks a grandchild into its group, like next start
  // and its workers, and prints the grandchild's pid once both are running.
  function startGroup(ignoreTerm: boolean): Promise<{ leader: ChildProcess; grandchild: number }> {
    const trap = ignoreTerm ? "process.on('SIGTERM', () => {});" : "";
    const grandchild = `${trap} setInterval(() => {}, 1000); process.stdout.write('up');`;
    const leader = `${trap}
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ['ignore', 'pipe', 'inherit'] });
      child.stdout.once('data', () => process.stdout.write(String(child.pid) + '\\n'));
      setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ["-e", leader], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
    started.push(child);
    return new Promise((resolve, reject) => {
      child.once("error", reject);
      child.stdout?.once("data", (chunk: Buffer) => resolve({ leader: child, grandchild: Number(chunk.toString().trim()) }));
    });
  }

  // A zombie (state Z) runs nothing: a container's PID 1 may never reap
  // orphans, so a stopped grandchild can linger in that state.
  function isRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
    } catch {
      return false;
    }
    try {
      return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
    } catch {
      return true;
    }
  }

  it("stops the leader and the process it forked", async () => {
    const { leader, grandchild } = await startGroup(false);
    await stopProcessGroup(leader.pid ?? -1, { graceMs: 5000, killWaitMs: 2000 });
    expect(isProcessGroupAlive(leader.pid ?? -1)).toBe(false);
    expect(isRunning(grandchild)).toBe(false);
  });

  it("kills a group that ignores SIGTERM once the grace period is over", async () => {
    const { leader, grandchild } = await startGroup(true);
    await stopProcessGroup(leader.pid ?? -1, { graceMs: 200, killWaitMs: 2000 });
    expect(isProcessGroupAlive(leader.pid ?? -1)).toBe(false);
    expect(isRunning(grandchild)).toBe(false);
  });
});

describe("readiness wait", () => {
  let server: Server;
  let url: string;
  let statuses: number[];

  beforeAll(async () => {
    server = createHttpServer((_request, response) => {
      response.writeHead(statuses.shift() ?? 503);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`;
  });

  afterAll(() => {
    server.close();
  });

  it("returns once the health endpoint answers 200", async () => {
    statuses = [503, 503, 200];
    await waitForHealthy(url, { deadlineMs: 5000, exitCode: () => null });
    expect(statuses).toEqual([]);
  });

  it("gives up at the deadline", async () => {
    statuses = [];
    await expect(waitForHealthy(url, { deadlineMs: 300, exitCode: () => null })).rejects.toThrow(
      /did not answer 200 within 300 ms \(last: status 503\)/,
    );
  });

  it("stops waiting when the server has exited", async () => {
    statuses = [];
    await expect(waitForHealthy(url, { deadlineMs: 5000, exitCode: () => 1 })).rejects.toThrow(/server exited \(1\)/);
  });
});

describe("smoke database", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "coffy-smoke-test-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("is a fresh migrated and seeded database at the given path, with no order", () => {
    const { databasePath } = smokePaths(dir);
    createSmokeDatabase(databasePath);
    const db = openDatabase({ env: { [DATABASE_PATH_ENV]: databasePath } });
    try {
      expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: listMigrations().length });
      expect(db.prepare("SELECT COUNT(*) AS count FROM products").get()).toEqual({ count: PRODUCT_FIXTURES.length });
      expect(db.prepare("SELECT COUNT(*) AS count FROM orders").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("is accepted after the run only once it holds a ready order", () => {
    const { databasePath } = smokePaths(dir);
    const env = { [DATABASE_PATH_ENV]: databasePath };
    expect(() => assertReadyOrderStored(databasePath)).toThrow(/no ready order/);

    const parsed = parseOrderRequest({
      customerName: "Smoke",
      items: [{ productId: "espresso", quantity: 1 }],
      idempotencyKey: "smoke-test-key-0001",
    });
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    const db = openDatabase({ env });
    let id: number;
    try {
      createOrder(db, parsed.request);
      id = Number((db.prepare("SELECT id FROM orders").get() as { id: number }).id);
    } finally {
      db.close();
    }
    expect(changeOrderStatus(id, "preparing", env).status).toBe("updated");
    expect(() => assertReadyOrderStored(databasePath)).toThrow(/no ready order/);
    expect(changeOrderStatus(id, "ready", env).status).toBe("updated");
    expect(() => assertReadyOrderStored(databasePath)).not.toThrow();
  });
});
