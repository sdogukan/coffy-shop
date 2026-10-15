import { parseArgs } from "node:util";
import { DATABASE_PATH_ENV, openDatabase } from "../db/connection.ts";
import { assertResettableDatabasePath } from "../db/reset-guard.ts";
import { resetDatabase } from "../db/reset.ts";
import { runCli } from "./run.ts";

// Usage: npm run reset -- --database <absolute path> --confirm-wipe
// Wipes a LOCAL database and rebuilds it as a fresh migrate + seed. The path
// comes only from --database, never from COFFY_DATABASE_PATH, so a shell that
// exports the server path cannot select it by accident.
const USAGE = "Usage: reset --database <absolute path to an existing local database> --confirm-wipe";

await runCli("reset", () => {
  let values: { database?: string; "confirm-wipe"?: boolean };
  try {
    ({ values } = parseArgs({
      options: { database: { type: "string" }, "confirm-wipe": { type: "boolean" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}. ${USAGE}`);
  }
  if (values.database === undefined) {
    throw new Error(USAGE);
  }
  if (values["confirm-wipe"] !== true) {
    throw new Error(`--confirm-wipe is required: every order, session and menu edit is deleted. ${USAGE}`);
  }
  const path = assertResettableDatabasePath(values.database, process.env);
  const db = openDatabase({ env: { [DATABASE_PATH_ENV]: path } });
  try {
    const { migrationsApplied, categoriesInserted, productsInserted } = resetDatabase(db);
    console.log(
      `Database reset: ${migrationsApplied.length} migrations, ${categoriesInserted} categories and ${productsInserted} products`,
    );
  } finally {
    db.close();
  }
});
