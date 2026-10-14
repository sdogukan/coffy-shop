import { backupDatabase } from "../db/backup.ts";
import { openDatabase } from "../db/connection.ts";
import { runCli } from "./run.ts";

// Usage: node src/cli/backup.ts <absolute destination file>
await runCli("backup", async () => {
  const destination = process.argv[2];
  if (destination === undefined || destination === "") {
    throw new Error("Usage: backup <absolute destination file>");
  }
  const db = openDatabase();
  try {
    const pages = await backupDatabase(db, destination);
    console.log(`Backup written (${pages} pages)`);
  } finally {
    db.close();
  }
});
