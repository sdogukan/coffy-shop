import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertResettableDatabasePath, ResetRefusedError } from "../../src/db/reset-guard.ts";

// The real server roots do not exist here, so the canonical-path checks are
// exercised against a temporary directory that stands in for one.
describe("assertResettableDatabasePath", () => {
  let dir: string;
  let local: string;
  let serverRoot: string;
  let serverDb: string;
  let roots: string[];

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "coffy-reset-guard-")));
    local = join(dir, "local.sqlite");
    writeFileSync(local, "");
    serverRoot = join(dir, "var-lib-coffy-shop");
    mkdirSync(join(serverRoot, "data"), { recursive: true });
    serverDb = join(serverRoot, "data", "coffy.sqlite");
    writeFileSync(serverDb, "");
    roots = [serverRoot];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the canonical path of an existing local file", () => {
    expect(assertResettableDatabasePath(local, {}, roots)).toBe(local);
    expect(assertResettableDatabasePath(join(dir, ".", "x", "..", "local.sqlite"), { NODE_ENV: "test" }, roots)).toBe(
      local,
    );
  });

  it("returns the target of a symlink, so the file checked is the file opened", () => {
    const link = join(dir, "link.sqlite");
    symlinkSync(local, link);
    expect(assertResettableDatabasePath(link, {}, roots)).toBe(local);
  });

  it.each(["production", "Production", " production "])("refuses NODE_ENV=%j", (value) => {
    expect(() => assertResettableDatabasePath(local, { NODE_ENV: value }, roots)).toThrow("NODE_ENV is production");
  });

  it.each(["", "  ", "local.sqlite", "./local.sqlite", "../tmp/local.sqlite"])("refuses the non-absolute path %j", (path) => {
    expect(() => assertResettableDatabasePath(path, {}, roots)).toThrow("must be absolute");
  });

  it("refuses a missing file, a dangling symlink and a directory", () => {
    const dangling = join(dir, "dangling.sqlite");
    symlinkSync(join(dir, "gone.sqlite"), dangling);
    expect(() => assertResettableDatabasePath(join(dir, "missing.sqlite"), {}, roots)).toThrow("does not exist");
    expect(() => assertResettableDatabasePath(dangling, {}, roots)).toThrow("does not exist");
    expect(() => assertResettableDatabasePath(dir, {}, roots)).toThrow("is not a file");
  });

  it("refuses a file under a forbidden root, and the root itself", () => {
    expect(() => assertResettableDatabasePath(serverDb, {}, roots)).toThrow(ResetRefusedError);
    expect(() => assertResettableDatabasePath(serverDb, {}, roots)).toThrow("under a server data directory");
    expect(() => assertResettableDatabasePath(serverRoot, {}, roots)).toThrow("under a server data directory");
    const dotted = join(serverRoot, "data", "..", "data", "coffy.sqlite");
    expect(() => assertResettableDatabasePath(dotted, {}, roots)).toThrow("under a server data directory");
  });

  it("refuses a symlinked file or parent directory that resolves under a forbidden root", () => {
    const fileLink = join(dir, "innocent.sqlite");
    symlinkSync(serverDb, fileLink);
    const dirLink = join(dir, "innocent-dir");
    symlinkSync(join(serverRoot, "data"), dirLink);
    expect(() => assertResettableDatabasePath(fileLink, {}, roots)).toThrow(`resolves to ${serverDb}`);
    expect(() => assertResettableDatabasePath(join(dirLink, "coffy.sqlite"), {}, roots)).toThrow(
      `resolves to ${serverDb}`,
    );
  });

  it("refuses a file reached through a forbidden root that is itself a symlink", () => {
    const realData = join(dir, "srv-coffy");
    mkdirSync(realData);
    const realDb = join(realData, "coffy.sqlite");
    writeFileSync(realDb, "");
    const linkedRoot = join(dir, "var-lib-dolmus-takip");
    symlinkSync(realData, linkedRoot);
    expect(() => assertResettableDatabasePath(realDb, {}, [linkedRoot])).toThrow("under a server data directory");
  });

  it("does not treat a sibling with the same prefix as under the root", () => {
    const sibling = `${serverRoot}-x`;
    mkdirSync(sibling);
    writeFileSync(join(sibling, "coffy.sqlite"), "");
    expect(assertResettableDatabasePath(join(sibling, "coffy.sqlite"), {}, roots)).toBe(join(sibling, "coffy.sqlite"));
  });

  it("refuses the real server roots by default, even where they do not exist", () => {
    for (const path of [
      "/var/lib/coffy-shop",
      "/var/lib/coffy-shop/data/coffy.sqlite",
      "/var/lib/dolmus-takip/data/dolmus.sqlite",
      "/var/lib/other/../coffy-shop/data/coffy.sqlite",
    ]) {
      expect(() => assertResettableDatabasePath(path, {})).toThrow("under a server data directory");
    }
  });
});
