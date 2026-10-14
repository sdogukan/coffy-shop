import { existsSync, rmSync } from "node:fs";
import { isAbsolute } from "node:path";
import { backup, type DatabaseSync } from "node:sqlite";

// Copies a live database with SQLite's online backup API, which is safe while
// the application keeps writing (unlike copying a WAL database file).
export async function backupDatabase(source: DatabaseSync, destination: string): Promise<number> {
  if (!isAbsolute(destination)) {
    throw new Error("Backup destination must be an absolute path");
  }
  if (existsSync(destination)) {
    throw new Error("Backup destination already exists");
  }
  try {
    return await backup(source, destination);
  } catch (error) {
    rmSync(destination, { force: true });
    throw error;
  }
}
