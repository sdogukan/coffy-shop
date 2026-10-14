import { openDatabase } from "../db/connection.ts";
import { runMigrations } from "../db/migrate.ts";
import { runCli } from "./run.ts";

await runCli("migrate", () => {
  const db = openDatabase({ create: true });
  try {
    const applied = runMigrations(db);
    console.log(applied.length > 0 ? `Applied migrations: ${applied.join(", ")}` : "No pending migrations");
  } finally {
    db.close();
  }
});
