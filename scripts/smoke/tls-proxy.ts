import { spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { buildUpstreamHeaders, withoutHopByHopHeaders } from "./smoke-env.ts";

// A local stand-in for Caddy: terminates TLS on 127.0.0.1 and forwards every
// request to the app on 127.0.0.1 with the Host header unchanged, so the app
// sees what it sees on the host under NODE_ENV=production.

export interface TlsProxy {
  port: number;
  close: () => Promise<void>;
}

export interface TlsProxyOptions {
  key: Buffer;
  cert: Buffer;
  upstreamPort: number;
}

// A self-signed P-256 certificate for 127.0.0.1, valid for one day. openssl is
// a system tool, not an npm dependency, so its absence is reported plainly.
export function generateSelfSignedCertificate(keyPath: string, certPath: string): void {
  const result = spawnSync(
    "openssl",
    ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "1",
      "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", keyPath, "-out", certPath],
    { encoding: "utf8" },
  );
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code;
    throw new Error(
      code === "ENOENT"
        ? "openssl was not found on PATH; install OpenSSL to run the smoke"
        : `openssl could not be started: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`openssl failed to create the proxy certificate (exit ${result.status}): ${result.stderr.trim()}`);
  }
}

export function startTlsProxy({ key, cert, upstreamPort }: TlsProxyOptions): Promise<TlsProxy> {
  const server = createServer({ key, cert }, (request, response) => {
    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port: upstreamPort,
        method: request.method,
        path: request.url,
        headers: buildUpstreamHeaders(request.headers, request.socket.remoteAddress),
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, withoutHopByHopHeaders(upstreamResponse.headers));
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", (error) => {
      console.error(`smoke proxy: ${request.method} ${request.url} failed upstream: ${error.message}`);
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Bad gateway");
    });
    request.pipe(upstream);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error === undefined ? done() : fail(error)));
            server.closeAllConnections();
          }),
      });
    });
  });
}
