#!/usr/bin/env bash
# Checks the Demo environment's deploy settings before anything touches the
# server. The deploy job passes every secret and variable through the
# environment; this script only ever prints their NAMES, never a value.

set -euo pipefail

readonly SECRETS=(COFFY_DEPLOY_SSH_PRIVATE_KEY COFFY_DEPLOY_KNOWN_HOSTS)
readonly VARIABLES=(COFFY_APP_URL COFFY_DEPLOY_HOST COFFY_DEPLOY_USER COFFY_DEPLOY_PATH COFFY_PORT COFFY_DATABASE_PATH)

missing=()
for name in "${SECRETS[@]}"; do
  [[ -n ${!name:-} ]] || missing+=("secret $name")
done
for name in "${VARIABLES[@]}"; do
  [[ -n ${!name:-} ]] || missing+=("variable $name")
done
if ((${#missing[@]} > 0)); then
  list=$(printf '%s, ' "${missing[@]}")
  printf '::error title=Demo deploy settings missing::Set these in the Demo environment (deploy/README.md section 5): %s\n' "${list%, }"
  exit 1
fi

problems=()
# The deploy is verified over HTTPS only.
[[ $COFFY_APP_URL =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] ||
  problems+=("variable COFFY_APP_URL must be an https:// origin such as https://host.example")
# Host and user end up on the ssh command line and in its config file.
[[ $COFFY_DEPLOY_HOST =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ ]] ||
  problems+=("variable COFFY_DEPLOY_HOST must be a host name or IP address")
[[ $COFFY_DEPLOY_USER =~ ^[a-z_][a-z0-9_-]*$ ]] ||
  problems+=("variable COFFY_DEPLOY_USER must be a Linux user name")
# Both paths end up in a remote shell command.
path_pattern='^(/[A-Za-z0-9._-]+)+$'
dot_segment='(^|/)\.\.?(/|$)'
if [[ ! $COFFY_DEPLOY_PATH =~ $path_pattern || $COFFY_DEPLOY_PATH =~ $dot_segment ]]; then
  problems+=("variable COFFY_DEPLOY_PATH must be an absolute path without . or .. segments")
fi
if [[ ! $COFFY_DATABASE_PATH =~ $path_pattern || $COFFY_DATABASE_PATH =~ $dot_segment ]]; then
  problems+=("variable COFFY_DATABASE_PATH must be an absolute path without . or .. segments")
elif [[ $COFFY_DATABASE_PATH == "${COFFY_DEPLOY_PATH%/}"/* ]]; then
  problems+=("variable COFFY_DATABASE_PATH must be outside COFFY_DEPLOY_PATH (a release directory is replaced on every deploy)")
fi
if [[ ! $COFFY_PORT =~ ^[1-9][0-9]{0,4}$ ]] || ((COFFY_PORT > 65535)); then
  problems+=("variable COFFY_PORT must be a port number")
fi

if ((${#problems[@]} > 0)); then
  for problem in "${problems[@]}"; do
    printf '::error title=Demo deploy settings invalid::%s\n' "$problem"
  done
  exit 1
fi
printf 'Demo deploy settings are present and well-formed.\n'
