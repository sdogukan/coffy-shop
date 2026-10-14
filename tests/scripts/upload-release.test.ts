import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../scripts/ci/upload-release.sh", import.meta.url));
const SHA = "0123456789abcdef0123456789abcdef01234567";

// Test double for ssh: checks the config file and host alias the script must
// use, then runs the remote command locally with the same stdin.
const FAKE_SSH = `#!/usr/bin/env bash
if [[ $# -ne 4 || $1 != -F || ! -f $2 || $3 != coffy-demo ]]; then
  echo "fake ssh: unexpected arguments: $*" >&2
  exit 255
fi
exec bash -c "$4"
`;

describe("upload-release.sh", () => {
  let root: string;
  let deployPath: string;
  let releasesDir: string;
  let sshConfig: string;
  let archive: string;
  let env: NodeJS.ProcessEnv;

  function makeArchive(files: Record<string, string>, path = archive): void {
    const source = mkdtempSync(join(root, "source-"));
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(source, name, ".."), { recursive: true });
      writeFileSync(join(source, name), content);
    }
    expect(spawnSync("tar", ["--create", "--gzip", "--file", path, "--directory", source, "."]).status).toBe(0);
  }

  function runUpload(args: string[] = [sshConfig, archive, deployPath, SHA]) {
    const result = spawnSync("bash", [SCRIPT, ...args], { env, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "coffy-upload-"));
    deployPath = join(root, "opt/coffy-shop");
    releasesDir = join(deployPath, "releases");
    mkdirSync(releasesDir, { recursive: true });
    sshConfig = join(root, "ssh-config");
    writeFileSync(sshConfig, "Host coffy-demo\n");
    archive = join(root, "release.tar.gz");
    makeArchive({ "server.js": "// new release\n", ".next/BUILD_ID": "build\n" });
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "ssh"), FAKE_SSH, { mode: 0o755 });
    env = { NODE_ENV: "test", PATH: `${bin}:${process.env.PATH}` };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("passes bash -n", () => {
    expect(spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" })).toMatchObject({ status: 0, stderr: "" });
  });

  it("unpacks the archive into releases/<sha> and leaves no temporary directory", () => {
    const result = runUpload();
    expect(result).toMatchObject({ status: 0, stderr: "" });
    expect(result.stdout).toContain(`Uploaded release ${SHA}`);
    expect(readdirSync(releasesDir)).toEqual([SHA]);
    expect(readFileSync(join(releasesDir, SHA, "server.js"), "utf8")).toBe("// new release\n");
    expect(readFileSync(join(releasesDir, SHA, ".next/BUILD_ID"), "utf8")).toBe("build\n");
    // Readable by coffy-shop, which runs the release.
    expect(statSync(join(releasesDir, SHA)).mode & 0o777).toBe(0o755);
  });

  it("keeps an existing release for the same SHA untouched on a re-run", () => {
    mkdirSync(join(releasesDir, SHA));
    writeFileSync(join(releasesDir, SHA, "server.js"), "// running release\n");
    const result = runUpload();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Release ${SHA} is already on the server; keeping it.`);
    expect(readdirSync(releasesDir)).toEqual([SHA]);
    expect(readdirSync(join(releasesDir, SHA))).toEqual(["server.js"]);
    expect(readFileSync(join(releasesDir, SHA, "server.js"), "utf8")).toBe("// running release\n");
  });

  it("does not create the release when the archive has no server.js", () => {
    makeArchive({ "index.js": "" });
    const result = runUpload();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("the archive has no server.js at its root");
    expect(readdirSync(releasesDir)).toEqual([]);
  });

  it("does not create the release from a truncated archive", () => {
    makeArchive({ "server.js": "x".repeat(200_000), "big.bin": Math.random().toString(36).repeat(20_000) });
    const full = readFileSync(archive);
    writeFileSync(archive, full.subarray(0, Math.floor(full.length / 2)));
    const result = runUpload();
    expect(result.status).not.toBe(0);
    expect(readdirSync(releasesDir)).toEqual([]);
  });

  it("fails clearly when the releases directory was never provisioned", () => {
    rmSync(releasesDir, { recursive: true });
    const result = runUpload();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("releases does not exist on the server; run deploy/provision.sh first");
  });

  it("fails when ssh cannot reach the server", () => {
    writeFileSync(join(root, "bin/ssh"), "#!/usr/bin/env bash\necho 'connection refused' >&2\nexit 255\n", { mode: 0o755 });
    const result = runUpload();
    expect(result.status).not.toBe(0);
    expect(readdirSync(releasesDir)).toEqual([]);
  });

  it.each([
    ["a short SHA", () => [sshConfig, archive, deployPath, SHA.slice(1)]],
    ["an uppercase SHA", () => [sshConfig, archive, deployPath, SHA.toUpperCase()]],
    ["a relative deploy path", () => [sshConfig, archive, "opt/coffy-shop", SHA]],
    ["a deploy path with a quote", () => [sshConfig, archive, "/opt/coffy'shop", SHA]],
    ["a missing argument", () => [sshConfig, archive, deployPath]],
  ])("rejects %s before contacting the server", (_case, args) => {
    const result = runUpload(args());
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: upload-release.sh");
  });

  it("rejects an empty archive before contacting the server", () => {
    writeFileSync(archive, "");
    const result = runUpload();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is missing or empty");
  });
});
