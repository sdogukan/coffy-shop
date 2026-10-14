import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../scripts/ci/verify-release.sh", import.meta.url));
const SHA = "0123456789abcdef0123456789abcdef01234567";

interface Reply {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

const healthy: Reply = { status: 200, body: JSON.stringify({ status: "ok", database: "ok" }) };
const version = (sha: string): Reply => ({ status: 200, body: JSON.stringify({ sha }) });

describe("verify-release.sh", () => {
  let dir: string;
  let server: Server;
  let baseUrl: string;
  // Replies per path, consumed one per request; the last one repeats.
  let replies: Record<string, Reply[]>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "coffy-verify-"));
    const generated = spawnSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
        "-addext", "subjectAltName=DNS:localhost", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")],
      { encoding: "utf8" },
    );
    expect(generated.status).toBe(0);
    server = createServer(
      { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) },
      (request, response) => {
        const queue = replies[request.url ?? ""] ?? [{ status: 404, body: "not found" }];
        const reply = queue.length > 1 ? queue.shift()! : queue[0]!;
        response.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
        response.end(reply.body);
      },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `https://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  // Asynchronous, so the in-process HTTPS server can answer while it runs.
  function runVerify(args: string[]): Promise<{ status: number; output: string }> {
    return new Promise((resolve) => {
      execFile(
        "bash",
        [SCRIPT, ...args],
        { env: { NODE_ENV: "test", PATH: process.env.PATH, CURL_CA_BUNDLE: join(dir, "cert.pem") } },
        (error, stdout, stderr) => {
          resolve({ status: error === null ? 0 : (error.code as number), output: stdout + stderr });
        },
      );
    });
  }

  it("passes bash -n", () => {
    expect(spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" })).toMatchObject({ status: 0, stderr: "" });
  });

  it("succeeds when health is ok and version reports exactly the SHA", async () => {
    replies = { "/api/health": [healthy], "/api/version": [version(SHA)] };
    const result = await runVerify([`${baseUrl}/`, SHA, "1", "0"]);
    expect(result).toEqual({ status: 0, output: `Release ${SHA} is healthy and serving at ${baseUrl}.\n` });
  });

  it("retries while the restarted server comes up", async () => {
    replies = {
      "/api/health": [{ status: 503, body: JSON.stringify({ status: "error", database: "unavailable" }) }, healthy],
      "/api/version": [version(SHA)],
    };
    const result = await runVerify([baseUrl, SHA, "3", "0"]);
    expect(result.status).toBe(0);
    expect(result.output).toContain("Attempt 1/3: /api/health is not ok");
  });

  it("fails after the last attempt when the previous release is still serving", async () => {
    const previous = "89abcdef0123456789abcdef0123456789abcdef";
    replies = { "/api/health": [healthy], "/api/version": [version(previous)] };
    const result = await runVerify([baseUrl, SHA, "2", "0"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`Attempt 2/2: /api/version reports ${previous}`);
    expect(result.output).toContain("::error title=Demo verification failed::");
  });

  it.each([
    ["a SHA prefix", SHA.slice(0, 7)],
    ["the SHA with a suffix", `${SHA}0`],
    ["an uppercase SHA", SHA.toUpperCase()],
  ])("does not accept %s as the deployed version", async (_case, reported) => {
    replies = { "/api/health": [healthy], "/api/version": [version(reported)] };
    expect((await runVerify([baseUrl, SHA, "1", "0"])).status).toBe(1);
  });

  it.each([
    ["a 503 health answer", { status: 503, body: JSON.stringify({ status: "error", database: "unavailable" }) }],
    ["a 200 answer reporting the database unavailable", { status: 200, body: JSON.stringify({ status: "ok", database: "unavailable" }) }],
    ["a redirect", { status: 301, body: "", headers: { location: "http://localhost/api/health" } }],
    ["a non-JSON answer", { status: 200, body: "<html>maintenance</html>" }],
  ])("fails on %s", async (_case, reply) => {
    replies = { "/api/health": [reply], "/api/version": [version(SHA)] };
    const result = await runVerify([baseUrl, SHA, "1", "0"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("/api/health is not ok");
  });

  it("fails when /api/version answers with an error", async () => {
    replies = { "/api/health": [healthy], "/api/version": [{ status: 500, body: JSON.stringify({ error: "Version unavailable" }) }] };
    const result = await runVerify([baseUrl, SHA, "1", "0"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("/api/version did not return a sha");
  });

  it.each([
    ["an http URL", () => [baseUrl.replace("https:", "http:"), SHA, "1", "0"]],
    ["a short SHA", () => [baseUrl, SHA.slice(1), "1", "0"]],
    ["zero attempts", () => [baseUrl, SHA, "0", "0"]],
    ["a missing argument", () => [baseUrl, SHA, "1"]],
  ])("rejects %s with usage", async (_case, args) => {
    const result = await runVerify(args());
    expect(result.status).toBe(2);
    expect(result.output).toContain("usage: verify-release.sh");
  });
});
