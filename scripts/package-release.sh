#!/usr/bin/env bash
# Packages the Next.js standalone build into the release archive the deploy
# job uploads to /opt/coffy-shop/releases/<sha>. Nothing is built on the
# server, so the archive must hold everything the wrapper and the unit run:
#
#   server.js, .next/, node_modules/, package.json   (Next.js standalone output)
#   .next/static, public/                            (standalone omits these)
#   migrations/*.sql, src/cli/, src/db/              (database entry points)
#   src/admin/                                       (imported by the admin hash CLI)
#   REVISION                                         (the commit the build is stamped with)
#
# Usage: package-release.sh <output directory>
# Run after `npm run build` on Linux x64 with Node 24; the archive is written
# to <output directory>/coffy-shop-<sha>-linux-x64.tar.gz.

set -euo pipefail
export LC_ALL=C

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly STANDALONE_DIR="$ROOT_DIR/.next/standalone"
readonly STATIC_DIR="$ROOT_DIR/.next/static"
readonly PUBLIC_DIR="$ROOT_DIR/public"
readonly SHA_PATTERN='^[0-9a-f]{40}$'

die() { printf 'package-release: error: %s\n' "$*" >&2; exit 1; }

if [[ $# -ne 1 || -z $1 ]]; then
  printf 'usage: package-release.sh <output directory>\n' >&2
  exit 2
fi
readonly OUTPUT_DIR=$1

# The standalone node_modules carries native binaries (sharp) for the build
# host, and the server runs the archive on Linux x64 with Node 24.
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] ||
  die "releases must be packaged on Linux x64 (this host is $(uname -sm))"
node_major=$(node -p 'process.versions.node.split(".")[0]')
[[ $node_major == 24 ]] || die "releases must be packaged with Node 24 (found Node $node_major)"

# Same source as next.config.ts, so the stamp matches the build.
SHA=${GITHUB_SHA:-$(git -C "$ROOT_DIR" rev-parse HEAD)}
[[ $SHA =~ $SHA_PATTERN ]] || die "release SHA must be 40 lowercase hex characters, got \"$SHA\""
readonly SHA

[[ -f $STANDALONE_DIR/server.js ]] || die "$STANDALONE_DIR/server.js is missing; run npm run build first"
[[ -d $STATIC_DIR ]] || die "$STATIC_DIR is missing; run npm run build first"
for script in backup.ts migrate.ts seed.ts; do
  [[ -f $ROOT_DIR/src/cli/$script ]] || die "src/cli/$script is missing"
done
shopt -s nullglob
migrations=("$ROOT_DIR"/migrations/*.sql)
shopt -u nullglob
((${#migrations[@]} > 0)) || die "no migration files in $ROOT_DIR/migrations"

# /api/version reports the SHA inlined at build time; an archive stamped with
# one SHA but built from another would never pass the deploy's version check.
grep -rqF -- "$SHA" "$STANDALONE_DIR/.next/server" ||
  die "the build is not stamped with $SHA; rebuild with GITHUB_SHA=$SHA"

WORK_DIR=$(mktemp -d)
trap 'rm -rf -- "$WORK_DIR"' EXIT
readonly STAGE_DIR="$WORK_DIR/release"
mkdir -- "$STAGE_DIR"

cp -a -- "$STANDALONE_DIR/." "$STAGE_DIR/"
cp -a -- "$STATIC_DIR" "$STAGE_DIR/.next/static"
if [[ -d $PUBLIC_DIR ]]; then
  cp -a -- "$PUBLIC_DIR" "$STAGE_DIR/public"
fi
mkdir -p -- "$STAGE_DIR/migrations" "$STAGE_DIR/src"
cp -- "${migrations[@]}" "$STAGE_DIR/migrations/"
cp -a -- "$ROOT_DIR/src/cli" "$ROOT_DIR/src/db" "$ROOT_DIR/src/admin" "$STAGE_DIR/src/"
printf '%s\n' "$SHA" >"$STAGE_DIR/REVISION"

# next build copies .env and .env.production into the standalone output, and
# nothing secret may leave the build job.
forbidden=$(find "$STAGE_DIR" \( -name '.env' -o -name '.env.*' -o -name '*.sqlite' -o -name '*.sqlite-*' \
  -o -name '*.sqlite3' -o -name '*.sqlite3-*' -o -name '*.db' -o -name '*.db-*' -o -name '*.pem' -o -name '*.key' \
  -o -name 'id_rsa*' -o -name 'id_ecdsa*' -o -name 'id_ed25519*' \) -printf '%P\n' | sort)
[[ -z $forbidden ]] || die "refusing to package environment, database or key files: ${forbidden//$'\n'/, }"

# Release files are uploaded by the deploy account and read by coffy-shop, so
# ownership is dropped and every entry is world-readable but not writable.
tar --create --gzip --file "$WORK_DIR/release.tar.gz" --directory "$STAGE_DIR" --sort=name \
  --owner=0 --group=0 --numeric-owner --mode='u+rwX,go+rX,go-w' .
tar --list --gzip --file "$WORK_DIR/release.tar.gz" ./server.js >/dev/null ||
  die "the archive has no ./server.js"

# The archive appears in the output directory only once it is complete.
mkdir -p -- "$OUTPUT_DIR"
readonly ARCHIVE="$OUTPUT_DIR/coffy-shop-$SHA-linux-x64.tar.gz"
mv -f -- "$WORK_DIR/release.tar.gz" "$ARCHIVE"
printf '%s\n' "$ARCHIVE"
