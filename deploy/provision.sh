#!/usr/bin/env bash
# Idempotent server bootstrap for Coffy Shop on the shared Lightsail host.
# Run as root from a checkout of this repository:
#
#   sudo bash deploy/provision.sh [--node /absolute/path/to/node]
#
# It creates what is missing and corrects what differs: the coffy-shop runtime
# account, the coffy-deploy deploy account, the directory layout, the systemd
# unit, the deploy wrapper and its sudoers rule. It never overwrites an
# existing environment file, database, backup or release, never edits Caddy and
# never touches the Dolmuş Takip service, its files or its Node installation.
# Re-running it is safe.

set -euo pipefail
umask 022
export LC_ALL=C
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

readonly RUN_USER=coffy-shop
readonly DEPLOY_USER=coffy-deploy
readonly BASE_DIR=/opt/coffy-shop
readonly STATE_DIR=/var/lib/coffy-shop
readonly CONFIG_DIR=/etc/coffy-shop
readonly ENV_FILE="$CONFIG_DIR/coffy-shop.env"
readonly WRAPPER=/usr/local/sbin/coffy-shop-deploy
readonly UNIT_FILE=/etc/systemd/system/coffy-shop.service
readonly SUDOERS_FILE=/etc/sudoers.d/coffy-deploy
readonly REQUIRED_NODE_MAJOR=24

SOURCE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
readonly SOURCE_DIR

log() { printf 'provision: %s\n' "$*"; }
die() { printf 'provision: error: %s\n' "$*" >&2; exit 1; }
usage() {
  printf 'usage: provision.sh [--node /absolute/path/to/node]\n' >&2
  exit 2
}
# True when neither group nor others may write to the path.
not_writable_by_others() {
  local mode
  mode=$(stat -c '%a' -- "$1")
  (((8#$mode & 8#022) == 0))
}

NODE_CANDIDATE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --node)
      [[ $# -ge 2 && $2 == /* ]] || usage
      NODE_CANDIDATE=$2
      shift 2
      ;;
    *) usage ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  die "must be run as root (sudo bash deploy/provision.sh)"
fi

for file in coffy-shop-deploy systemd/coffy-shop.service sudoers/coffy-deploy coffy-shop.env.example; do
  [[ -f $SOURCE_DIR/$file ]] || die "missing $SOURCE_DIR/$file; run this script from the repository's deploy directory"
done

WORK_DIR=$(mktemp -d)
readonly WORK_DIR
trap 'rm -rf -- "$WORK_DIR"' EXIT

ensure_group() {
  if getent group "$1" >/dev/null; then
    log "group $1 exists"
  else
    groupadd --system "$1"
    log "created group $1"
  fi
}

# Creates the account when missing. An existing account is left as it is.
ensure_user() {
  local name=$1
  shift
  if id -u "$name" >/dev/null 2>&1; then
    log "user $name exists"
  else
    useradd "$@" "$name"
    log "created user $name"
  fi
}

# Creates the directory, or corrects its owner and mode. Never recursive, so
# the files inside (database, backups, releases) are not touched.
ensure_dir() {
  local path=$1 owner=$2 group=$3 mode=$4
  [[ ! -L $path ]] || die "$path is a symlink; refusing to use it"
  if [[ ! -d $path ]]; then
    install -d -o "$owner" -g "$group" -m "$mode" -- "$path"
    log "created $path ($owner:$group $mode)"
    return
  fi
  if [[ $(stat -c '%U:%G' -- "$path") != "$owner:$group" ]]; then
    chown -- "$owner:$group" "$path"
    log "set owner of $path to $owner:$group"
  fi
  if [[ $(stat -c '%a' -- "$path") != "${mode#0}" ]]; then
    chmod -- "$mode" "$path"
    log "set mode of $path to $mode"
  fi
}

# Installs src at dest when dest is missing or differs in content, owner or
# mode. The new file is renamed into place so dest is never half-written.
# Returns 0 when it changed something, 1 when dest was already up to date.
install_file() {
  local src=$1 dest=$2 owner=$3 group=$4 mode=$5
  local tmp
  tmp="$(dirname -- "$dest")/.$(basename -- "$dest").new"
  [[ ! -L $dest ]] || die "$dest is a symlink; refusing to replace it"
  if [[ -f $dest ]] && cmp -s -- "$src" "$dest" &&
    [[ $(stat -c '%U:%G %a' -- "$dest") == "$owner:$group ${mode#0}" ]]; then
    log "$dest is up to date"
    return 1
  fi
  rm -f -- "$tmp" || die "cannot remove $tmp"
  install -o "$owner" -g "$group" -m "$mode" -- "$src" "$tmp" || die "cannot write $tmp"
  mv -fT -- "$tmp" "$dest" || die "cannot rename $tmp to $dest"
  log "installed $dest"
  return 0
}

# Prints the absolute Node 24 binary coffy-shop will run. The path is resolved
# through symlinks so a later change of a shared "node" link (for example by
# another application on this host) cannot silently change Coffy Shop's
# runtime.
resolve_node() {
  local candidate=$NODE_CANDIDATE resolved version
  if [[ -z $candidate ]]; then
    candidate=$(command -v node || true)
    [[ -n $candidate ]] || die "no node on root's PATH; install Node $REQUIRED_NODE_MAJOR for all users and pass --node (see deploy/README.md)"
  fi
  resolved=$(readlink -f -- "$candidate") || die "cannot resolve $candidate"
  [[ $resolved =~ ^/[A-Za-z0-9._/+-]+$ ]] || die "Node path $resolved contains unsupported characters"
  case "$resolved" in
    /home/* | /root/* | /tmp/* | /var/tmp/*)
      die "Node path $resolved is under a user or temporary directory (e.g. nvm); install Node $REQUIRED_NODE_MAJOR system-wide and pass --node"
      ;;
  esac
  [[ -f $resolved && -O $resolved ]] || die "Node binary $resolved must be a file owned by root"
  not_writable_by_others "$resolved" || die "Node binary $resolved must not be writable by group or others"
  version=$(cd / && setpriv --reuid="$RUN_USER" --regid="$RUN_USER" --init-groups -- \
    /usr/bin/env -i PATH=/usr/bin:/bin "$resolved" -p 'process.versions.node') ||
    die "$RUN_USER cannot execute $resolved"
  [[ ${version%%.*} == "$REQUIRED_NODE_MAJOR" ]] ||
    die "$resolved is Node $version as $RUN_USER; Node $REQUIRED_NODE_MAJOR is required"
  log "verified Node $version at $resolved (executed as $RUN_USER)" >&2
  printf '%s' "$resolved"
}

render() {
  sed -e "s|@COFFY_NODE_BIN@|$NODE_BIN|g" -- "$1" >"$2"
}

# Users. The deploy account logs in with an SSH key only: '*' is a password
# that never matches but, unlike a locked account, does not block key login.
ensure_group "$RUN_USER"
ensure_user "$RUN_USER" --system --gid "$RUN_USER" --home-dir "$STATE_DIR" --no-create-home --shell /usr/sbin/nologin
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  ensure_group "$DEPLOY_USER"
  ensure_user "$DEPLOY_USER" --gid "$DEPLOY_USER" --create-home --shell /bin/bash
  usermod -p '*' "$DEPLOY_USER"
else
  log "user $DEPLOY_USER exists"
fi

# Directories. Releases are written by the deploy account and only readable by
# coffy-shop; the current/previous links live in the root-owned base directory.
ensure_dir "$BASE_DIR" root root 0755
ensure_dir "$BASE_DIR/releases" "$DEPLOY_USER" "$DEPLOY_USER" 0755
ensure_dir "$STATE_DIR" root root 0755
ensure_dir "$STATE_DIR/data" "$RUN_USER" "$RUN_USER" 0700
ensure_dir "$STATE_DIR/backups" "$RUN_USER" "$RUN_USER" 0700
ensure_dir "$CONFIG_DIR" root root 0755

NODE_BIN=$(resolve_node)
readonly NODE_BIN

# Deploy wrapper: root-owned in a directory the deploy account cannot write.
[[ -O /usr/local/sbin ]] && not_writable_by_others /usr/local/sbin ||
  die "/usr/local/sbin must be owned by root and not writable by others"
render "$SOURCE_DIR/coffy-shop-deploy" "$WORK_DIR/coffy-shop-deploy"
install_file "$WORK_DIR/coffy-shop-deploy" "$WRAPPER" root root 0755 || true

# systemd unit.
render "$SOURCE_DIR/systemd/coffy-shop.service" "$WORK_DIR/coffy-shop.service"
UNIT_CHANGED=false
if install_file "$WORK_DIR/coffy-shop.service" "$UNIT_FILE" root root 0644; then
  UNIT_CHANGED=true
  systemctl daemon-reload
fi
if systemctl is-enabled --quiet coffy-shop.service; then
  log "coffy-shop.service is enabled"
else
  # Enabled for boot, not started: the first deploy starts it once a release exists.
  systemctl enable coffy-shop.service
  log "enabled coffy-shop.service (not started)"
fi
if [[ $UNIT_CHANGED == true ]] && systemctl is-active --quiet coffy-shop.service; then
  log "coffy-shop.service is running with the old unit; the next deploy (or 'systemctl restart coffy-shop') applies it"
fi

# Environment file: installed from the example only when absent. An existing
# file holds the operator's values and is never modified.
if [[ -e $ENV_FILE || -L $ENV_FILE ]]; then
  log "$ENV_FILE exists; left unchanged"
else
  install -o root -g "$RUN_USER" -m 0640 -- "$SOURCE_DIR/coffy-shop.env.example" "$ENV_FILE"
  log "installed $ENV_FILE from the example; fill in every value before the first deploy"
fi

# sudoers rule: validated on its own before it is renamed into place, because a
# broken file in /etc/sudoers.d disables sudo for every user on this host.
install -o root -g root -m 0440 -- "$SOURCE_DIR/sudoers/coffy-deploy" "$WORK_DIR/coffy-deploy.sudoers"
visudo -cqf "$WORK_DIR/coffy-deploy.sudoers" || die "sudoers rule failed visudo validation; nothing installed"
install_file "$WORK_DIR/coffy-deploy.sudoers" "$SUDOERS_FILE" root root 0440 || true
visudo -cq || die "visudo -c reports an error in the sudoers configuration; fix it before logging out"

log "done. Dolmuş Takip, Caddy, existing data and releases were not touched."
log "next: fill in $ENV_FILE, add the deploy SSH key and the Caddy site block (deploy/README.md)"
