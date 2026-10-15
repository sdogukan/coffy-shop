import { realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import type { Env } from "./connection.ts";

// The server databases on the hosts. src/db/ ships in every release, so this
// list (and the NODE_ENV check) is what keeps reset away from live data.
export const FORBIDDEN_RESET_ROOTS: readonly string[] = ["/var/lib/coffy-shop", "/var/lib/dolmus-takip"];

export class ResetRefusedError extends Error {
  constructor(reason: string) {
    super(`Reset refused: ${reason}`);
    this.name = "ResetRefusedError";
  }
}

function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

// A root may itself be a symlink on a host, so the canonical form of an
// existing root is forbidden as well as its literal form.
function forbiddenRoots(roots: readonly string[]): string[] {
  return roots.flatMap((root) => {
    try {
      return [root, realpathSync(root)];
    } catch {
      return [root];
    }
  });
}

// Returns the canonical (symlink-free) path of an existing local database
// file, or throws. Callers must open the returned path, never the argument, so
// the file checked is the file reset. Every check fails closed.
export function assertResettableDatabasePath(
  path: string,
  env: Env,
  roots: readonly string[] = FORBIDDEN_RESET_ROOTS,
): string {
  if (env.NODE_ENV?.trim().toLowerCase() === "production") {
    throw new ResetRefusedError("NODE_ENV is production");
  }
  if (path.trim() === "" || !isAbsolute(path)) {
    throw new ResetRefusedError("the database path must be absolute");
  }
  const forbidden = forbiddenRoots(roots);
  const isForbidden = (candidate: string) => forbidden.some((root) => isUnder(candidate, root));
  // Checked before touching the file system as well, so a server path is
  // refused even where it does not exist.
  if (isForbidden(resolve(path))) {
    throw new ResetRefusedError(`${path} is under a server data directory`);
  }
  let canonical: string;
  try {
    canonical = realpathSync(path);
  } catch {
    // A missing file or a dangling symlink: its target is unknown, so it is
    // never trusted.
    throw new ResetRefusedError(`${path} does not exist or cannot be resolved`);
  }
  if (isForbidden(canonical)) {
    throw new ResetRefusedError(`${path} resolves to ${canonical}, which is under a server data directory`);
  }
  if (!statSync(canonical).isFile()) {
    throw new ResetRefusedError(`${path} is not a file`);
  }
  return canonical;
}
