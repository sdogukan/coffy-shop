import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

// The deployed commit is stamped into the build so /api/version cannot be
// changed by a runtime environment variable. CI provides GITHUB_SHA; local
// builds fall back to the checked-out commit.
function resolveBuildSha(): string {
  const sha =
    process.env.GITHUB_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(`Build SHA must be 40 lowercase hex characters, got "${sha}"`);
  }
  return sha;
}

const nextConfig: NextConfig = {
  output: "standalone",
  images: { unoptimized: true },
  env: {
    COFFY_BUILD_SHA: resolveBuildSha(),
  },
};

export default nextConfig;
