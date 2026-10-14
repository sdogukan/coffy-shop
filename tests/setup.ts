import { afterEach } from "vitest";
import { DATABASE_PATH_ENV } from "../src/db/connection.ts";

// A developer's shell may export the dev database path. Tests must only ever
// use the temporary database a test creates for itself.
delete process.env[DATABASE_PATH_ENV];

afterEach(() => {
  delete process.env[DATABASE_PATH_ENV];
});
