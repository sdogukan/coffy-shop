#!/usr/bin/env bash
# Uploads a release archive to <deploy path>/releases/<sha> on the Demo server.
# The archive is unpacked under a temporary name and renamed into place only
# when it is complete, so the wrapper can never activate a partial upload. A
# release directory that already exists (a re-run for the same SHA) is kept
# as it is, because it may be the one currently serving.
#
# Usage: upload-release.sh <ssh config> <archive> <deploy path> <sha>
# The ssh config defines the host alias coffy-demo (written by the deploy job).

set -euo pipefail

readonly SSH_HOST=coffy-demo
readonly SHA_PATTERN='^[0-9a-f]{40}$'
readonly PATH_PATTERN='^(/[A-Za-z0-9._-]+)+$'

die() { printf 'upload-release: error: %s\n' "$*" >&2; exit 1; }

if [[ $# -ne 4 ]]; then
  printf 'usage: upload-release.sh <ssh config> <archive> <deploy path> <sha>\n' >&2
  exit 2
fi
readonly SSH_CONFIG=$1 ARCHIVE=$2 DEPLOY_PATH=$3 SHA=$4
# Both values are placed inside the remote shell command below.
if [[ ! $SHA =~ $SHA_PATTERN || ! $DEPLOY_PATH =~ $PATH_PATTERN ]]; then
  printf 'usage: upload-release.sh <ssh config> <archive> <deploy path> <sha>\n' >&2
  exit 2
fi
[[ -f $SSH_CONFIG ]] || die "ssh config $SSH_CONFIG does not exist"
[[ -s $ARCHIVE ]] || die "archive $ARCHIVE is missing or empty"

readonly RELEASES_DIR="$DEPLOY_PATH/releases"
readonly FINAL_DIR="$RELEASES_DIR/$SHA"

remote() {
  ssh -F "$SSH_CONFIG" "$SSH_HOST" "$1"
}

state=$(remote "if [ -d '$FINAL_DIR' ]; then echo present; elif [ -d '$RELEASES_DIR' ]; then echo absent; else echo no-releases-dir; fi")
case $state in
  present)
    printf 'Release %s is already on the server; keeping it.\n' "$SHA"
    exit 0
    ;;
  absent) ;;
  no-releases-dir) die "$RELEASES_DIR does not exist on the server; run deploy/provision.sh first" ;;
  *) die "unexpected answer from the server: $state" ;;
esac

# mktemp creates the directory 0700; it is opened up only after the archive
# has been unpacked, right before the rename. A dropped connection ends tar
# with an error and the trap removes the partial directory.
remote "set -eu
umask 022
tmp=\$(mktemp -d '$RELEASES_DIR/.incoming-$SHA.XXXXXX')
trap 'rm -rf -- \"\$tmp\"' EXIT
trap 'exit 1' HUP INT TERM
tar -xzf - -C \"\$tmp\" --no-same-owner
if [ ! -f \"\$tmp/server.js\" ]; then
  echo 'upload-release: error: the archive has no server.js at its root' >&2
  exit 1
fi
chmod 0755 \"\$tmp\"
mv -T -- \"\$tmp\" '$FINAL_DIR'" <"$ARCHIVE"

printf 'Uploaded release %s to %s.\n' "$SHA" "$FINAL_DIR"
