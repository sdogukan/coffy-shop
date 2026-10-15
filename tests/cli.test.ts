import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAdminPasswordHash, verifyAdminPassword } from "../src/admin/password.ts";
import { createAdminSession } from "../src/db/admin-sessions.ts";
import { PRODUCT_FIXTURES, seedCatalog } from "../src/db/catalog.ts";
import { listMigrations } from "../src/db/migrate.ts";
import { createOrder } from "../src/db/orders.ts";
import { parseOrderRequest } from "../src/orders/order-request.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

const CLI_DIR = fileURLToPath(new URL("../src/cli/", import.meta.url));

// The deploy wrapper runs these entry points with plain `node` and relies on
// their exit codes, so they are exercised the same way here.
function runCli(script: string, env: NodeJS.ProcessEnv, args: string[] = [], input?: string, cwd?: string) {
  const result = spawnSync(process.execPath, [join(CLI_DIR, script), ...args], {
    env: { ...env, PATH: process.env.PATH },
    encoding: "utf8",
    input,
    cwd,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("database entry points", () => {
  let temp: TempDatabase;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    temp = createTempDatabase();
    env = { COFFY_DATABASE_PATH: temp.path, NODE_ENV: "production" };
  });

  afterEach(() => {
    temp.cleanup();
  });

  it("migrate creates the database and is a no-op the second time", () => {
    expect(runCli("migrate.ts", env)).toMatchObject({ status: 0, stderr: "" });
    expect(runCli("migrate.ts", env)).toMatchObject({ status: 0, stdout: "No pending migrations\n" });
  });

  it("seed and backup run against a migrated database", () => {
    runCli("migrate.ts", env);
    expect(runCli("seed.ts", env)).toMatchObject({ status: 0, stdout: "Seed inserted 2 categories and 8 products\n" });
    expect(runCli("seed.ts", env)).toMatchObject({ status: 0, stdout: "Seed inserted 0 categories and 0 products\n" });

    const destination = join(temp.dir, "backup.sqlite");
    expect(runCli("backup.ts", env, [destination]).status).toBe(0);
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      expect(copy.prepare("SELECT COUNT(*) AS total FROM products").get()).toEqual({ total: 8 });
    } finally {
      copy.close();
    }
  });

  it.each(["migrate.ts", "seed.ts", "backup.ts"])("%s exits non-zero without COFFY_DATABASE_PATH", (script) => {
    const result = runCli(script, { NODE_ENV: "production" }, ["/tmp/unused-backup.sqlite"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("COFFY_DATABASE_PATH is not set");
  });

  it("seed and backup do not create a missing database", () => {
    expect(runCli("seed.ts", env).status).toBe(1);
    expect(runCli("backup.ts", env, [join(temp.dir, "backup.sqlite")]).status).toBe(1);
    expect(existsSync(temp.path)).toBe(false);
  });

  it("backup exits non-zero without a destination", () => {
    runCli("migrate.ts", env);
    const result = runCli("backup.ts", env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage");
  });
});

describe("reset", () => {
  let temp: TempDatabase;
  // COFFY_DATABASE_PATH names the database on purpose: reset must ignore it.
  let env: NodeJS.ProcessEnv;

  // A migrated database with an order, an admin session and a menu edit.
  function populate() {
    expect(runCli("migrate.ts", env).status).toBe(0);
    const db = new DatabaseSync(temp.path);
    try {
      seedCatalog(db);
      const parsed = parseOrderRequest({
        customerName: "Ayşe",
        items: [{ productId: "espresso", quantity: 1 }],
        idempotencyKey: "cli_reset_order_key_01",
      });
      if (!parsed.ok || createOrder(db, parsed.request).status !== "created") {
        throw new Error("test order was not created");
      }
      createAdminSession(db, "b".repeat(64));
      db.prepare("UPDATE products SET price_kurus = 1 WHERE id = 'espresso'").run();
    } finally {
      db.close();
    }
  }

  function query(sql: string) {
    const db = new DatabaseSync(temp.path, { readOnly: true });
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  }

  function expectRefusedAndUnchanged(result: ReturnType<typeof runCli>, message: string) {
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("reset failed: ");
    expect(result.stderr).toContain(message);
  }

  beforeEach(() => {
    temp = createTempDatabase();
    env = { COFFY_DATABASE_PATH: temp.path, NODE_ENV: "development" };
    populate();
  });

  afterEach(() => {
    temp.cleanup();
  });

  it("rebuilds the database named by --database as a fresh migrate + seed", () => {
    const result = runCli("reset.ts", env, ["--database", temp.path, "--confirm-wipe"]);
    expect(result).toMatchObject({ status: 0, stderr: "" });
    expect(result.stdout).toBe(`Database reset: ${listMigrations().length} migrations, 2 categories and 8 products\n`);

    expect(query("SELECT COUNT(*) AS total FROM categories")).toEqual([{ total: 2 }]);
    expect(query("SELECT id FROM products ORDER BY id").map((row) => row.id)).toEqual(
      PRODUCT_FIXTURES.map((product) => product.id).sort(),
    );
    expect(query("SELECT price_kurus FROM products WHERE id = 'espresso'")).toEqual([{ price_kurus: 9000 }]);
    expect(query("SELECT COUNT(*) AS total FROM orders")).toEqual([{ total: 0 }]);
    expect(query("SELECT COUNT(*) AS total FROM order_items")).toEqual([{ total: 0 }]);
    expect(query("SELECT COUNT(*) AS total FROM admin_sessions")).toEqual([{ total: 0 }]);
    expect(query("SELECT name FROM schema_migrations ORDER BY name").map((row) => row.name)).toEqual(listMigrations());
  });

  describe("refuses and leaves the database file unchanged", () => {
    let before: Buffer;

    beforeEach(() => {
      before = readFileSync(temp.path);
    });

    afterEach(() => {
      expect(readFileSync(temp.path).equals(before)).toBe(true);
      expect(query("SELECT COUNT(*) AS total FROM orders")).toEqual([{ total: 1 }]);
    });

    it("without the confirm flag", () => {
      expectRefusedAndUnchanged(runCli("reset.ts", env, ["--database", temp.path]), "--confirm-wipe is required");
    });

    it("without --database, even though COFFY_DATABASE_PATH is set", () => {
      expectRefusedAndUnchanged(runCli("reset.ts", env, ["--confirm-wipe"]), "Usage: reset --database");
    });

    it("with an empty --database", () => {
      expectRefusedAndUnchanged(runCli("reset.ts", env, ["--database", "", "--confirm-wipe"]), "must be absolute");
    });

    it("with a relative path that names the database from the working directory", () => {
      const result = runCli("reset.ts", env, ["--database", "coffy.sqlite", "--confirm-wipe"], undefined, temp.dir);
      expectRefusedAndUnchanged(result, "must be absolute");
    });

    it.each([
      ["a positional path", (path: string) => [path, "--confirm-wipe"]],
      ["an unknown option", (path: string) => ["--database", path, "--confirm-wipe", "--force"]],
      ["a value on the confirm flag", (path: string) => ["--database", path, "--confirm-wipe=yes"]],
    ])("with %s", (_name, args) => {
      expectRefusedAndUnchanged(runCli("reset.ts", env, args(temp.path)), "Usage: reset --database");
    });

    it("under NODE_ENV=production", () => {
      const result = runCli("reset.ts", { ...env, NODE_ENV: "production" }, ["--database", temp.path, "--confirm-wipe"]);
      expectRefusedAndUnchanged(result, "NODE_ENV is production");
    });

    it("with a missing file, without creating it", () => {
      const missing = join(temp.dir, "missing.sqlite");
      expectRefusedAndUnchanged(runCli("reset.ts", env, ["--database", missing, "--confirm-wipe"]), "does not exist");
      expect(existsSync(missing)).toBe(false);
    });

    it.each(["/var/lib/coffy-shop/data/coffy.sqlite", "/var/lib/dolmus-takip/data/dolmus.sqlite"])(
      "with the server path %s",
      (path) => {
        const result = runCli("reset.ts", env, ["--database", path, "--confirm-wipe"]);
        expectRefusedAndUnchanged(result, "under a server data directory");
      },
    );

    it("with a temp symlink to a server database file", () => {
      const link = join(temp.dir, "link.sqlite");
      symlinkSync("/var/lib/coffy-shop/data/coffy.sqlite", link);
      expectRefusedAndUnchanged(runCli("reset.ts", env, ["--database", link, "--confirm-wipe"]), "Reset refused");
    });

    it("with a path through a temp symlink to a server data directory", () => {
      const link = join(temp.dir, "server-data");
      symlinkSync("/var/lib/dolmus-takip", link);
      const result = runCli("reset.ts", env, ["--database", join(link, "data", "dolmus.sqlite"), "--confirm-wipe"]);
      expectRefusedAndUnchanged(result, "Reset refused");
    });
  });

  it("is exposed as an npm script that runs the entry point with plain node", () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
    expect(manifest.scripts.reset).toBe("node src/cli/reset.ts");
  });
});

describe("admin:hash-password", () => {
  // No admin or database variables: the CLI needs none.
  const CLI_ENV: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  const password = "Gizli Kahve Parolası 42";

  it("prints only a hash of the piped password that the verifier accepts", async () => {
    const result = runCli("hash-admin-password.ts", CLI_ENV, [], `${password}\n`);
    expect(result).toMatchObject({ status: 0, stderr: "" });
    expect(result.stdout).toMatch(/^scrypt\.[^\s]+\n$/);
    expect(result.stdout).not.toContain(password);
    const hash = parseAdminPasswordHash(result.stdout.trim());
    expect(hash).not.toBeNull();
    expect(await verifyAdminPassword(password, hash!)).toBe(true);
    // Only one trailing line break is stripped; the rest is the password.
    expect(await verifyAdminPassword(`${password}\n`, hash!)).toBe(false);
  });

  it("strips a Windows line ending as well", async () => {
    const result = runCli("hash-admin-password.ts", CLI_ENV, [], `${password}\r\n`);
    expect(await verifyAdminPassword(password, parseAdminPasswordHash(result.stdout.trim())!)).toBe(true);
  });

  it("refuses a password passed as an argument without echoing it", () => {
    const result = runCli("hash-admin-password.ts", CLI_ENV, [password]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("read from standard input");
    expect(result.stderr).not.toContain(password);
  });

  it("refuses an empty password", () => {
    const result = runCli("hash-admin-password.ts", CLI_ENV, [], "\n");
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("1 to 1024 characters");
  });

  it("is exposed as an npm script that runs the entry point with plain node", () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
    expect(manifest.scripts["admin:hash-password"]).toBe("node src/cli/hash-admin-password.ts");
  });
});
