# Coffy Shop server runbook

Operator guide for the Coffy Shop Demo deployment on the existing Lightsail host
(Ubuntu 24.04, shared with Dolmuş Takip). Everything here is done by a person with
sudo on the server; nothing in this directory runs automatically except the deploy
wrapper, which the GitHub deploy job calls over SSH.

**Complete sections 1–5 before the first merge to `main`.** Until then the deploy job
fails with a message naming the missing GitHub settings, or the wrapper refuses to
activate, and nothing is published.

## Files in this directory

| File | Installed to | Purpose |
| --- | --- | --- |
| `provision.sh` | run in place | Idempotent bootstrap: accounts, directories, Node check, unit, wrapper, sudoers rule, env file (only if absent). |
| `coffy-shop-deploy` | `/usr/local/sbin/coffy-shop-deploy` (root:root 0755) | Activate/rollback wrapper the deploy job runs with sudo. |
| `systemd/coffy-shop.service` | `/etc/systemd/system/coffy-shop.service` | Runs the server as `coffy-shop` on 127.0.0.1:3002. |
| `sudoers/coffy-deploy` | `/etc/sudoers.d/coffy-deploy` (root:root 0440) | Lets `coffy-deploy` run the wrapper and nothing else. |
| `coffy-shop.env.example` | `/etc/coffy-shop/coffy-shop.env` (root:coffy-shop 0640) | Variable names only; values are filled in on the server. |
| `caddy/coffy-shop.caddy` | added by hand to the Caddy config | Site block for `coffy.52-29-95-160.sslip.io`. |

## Server layout

| Path | Owner, mode | Contents |
| --- | --- | --- |
| `/opt/coffy-shop` | root, 0755 | `current` and `previous` links (written only by the wrapper). |
| `/opt/coffy-shop/releases/<sha>/` | coffy-deploy, 0755 | One directory per release, uploaded complete by the deploy job. `coffy-shop` can read but not write it. |
| `/var/lib/coffy-shop/data` | coffy-shop, 0700 | The SQLite database (`COFFY_DATABASE_PATH`). Never inside a release. |
| `/var/lib/coffy-shop/backups` | coffy-shop, 0700 | Online backups taken before every migration. |
| `/etc/coffy-shop/coffy-shop.env` | root:coffy-shop, 0640 | Runtime environment. |

Accounts: `coffy-shop` runs the application (no login shell); `coffy-deploy` is the SSH
account the deploy job uses (key login only, sudo for the wrapper only).

A release directory must contain, at its root: the Next.js standalone `server.js` with
its `.next/` and `node_modules/`, `.next/static` and `public`, `package.json` (with
`"type": "module"`), `migrations/`, and `src/cli/` + `src/db/` (the database entry
points the wrapper runs: `src/cli/backup.ts`, `src/cli/migrate.ts`, `src/cli/seed.ts`).

## 1. Provision the server

1. Copy this repository's `deploy/` directory to the server (for example
   `scp -r deploy <admin>@<host>:coffy-shop-deploy`), then on the server:

   ```bash
   cd ~/coffy-shop-deploy
   sudo bash provision.sh            # or: sudo bash provision.sh --node /opt/node-v24/bin/node
   ```

2. Node 24. The script resolves `node` from root's PATH (or `--node`), follows symlinks
   to the real binary, refuses anything under `/home`, `/root` or a temporary directory
   (an nvm install under `/home/ubuntu` is not readable by `coffy-shop`), requires a
   root-owned binary that group/others cannot write, and runs it **as `coffy-shop`** to
   check the major version is 24. The verified path is written into the unit and the
   wrapper; re-run the script after changing Node.

   If no suitable Node 24 exists, install a separate copy without touching the `node`
   binary Dolmuş Takip uses — for example the official Linux x64 tarball from
   nodejs.org, checksum verified against its `SHASUMS256.txt`, extracted to
   `/opt/node-v24` (root-owned) — and pass `--node /opt/node-v24/bin/node`.

3. What the script does, each step only when something is missing or different:
   creates the `coffy-shop` and `coffy-deploy` accounts; creates or corrects the owner
   and mode of the directories above (never recursively, so data, backups and releases
   are untouched); installs the wrapper, the unit (then `daemon-reload` and `enable` —
   it does **not** start the service; the first deploy does) and the sudoers rule
   (checked with `visudo -cf` before it is renamed into place, then `visudo -c`);
   installs the env file from the example **only if it does not exist**.

   It never edits Caddy, never modifies an existing env file, database, backup or
   release, and never touches the Dolmuş Takip service, its files or its Node.

4. Check the result:

   ```bash
   sudo systemctl cat coffy-shop          # ExecStart shows the verified Node path
   sudo systemd-analyze verify /etc/systemd/system/coffy-shop.service
   sudo visudo -c
   sudo -u coffy-deploy sudo -l           # lists only /usr/local/sbin/coffy-shop-deploy
   ```

## 2. Fill in the environment file

Edit `/etc/coffy-shop/coffy-shop.env` (`sudo -e /etc/coffy-shop/coffy-shop.env`). The
wrapper refuses to activate until `HOSTNAME`, `PORT` and `COFFY_DATABASE_PATH` are set
correctly.

| Variable | Meaning |
| --- | --- |
| `NODE_ENV` | `production`. |
| `HOSTNAME` | Interface the server listens on. Must be `127.0.0.1` (an empty value would listen on every interface). |
| `PORT` | `3002` — the port the Caddy site block proxies to. |
| `COFFY_DATABASE_PATH` | Absolute path of the SQLite file under `/var/lib/coffy-shop/data`. Must be outside `/opt/coffy-shop` and equal the GitHub `COFFY_DATABASE_PATH` variable. |
| `COFFY_RELEASE_ENVIRONMENT` | Environment label, e.g. `demo`. |
| `COFFY_ADMIN_USERNAME` | Staff login name (used once the staff area ships). |
| `COFFY_ADMIN_PASSWORD_HASH` | Hash of the staff password (never the plain password). |

Write values unquoted (`NAME=value`); the file is read by systemd, not by a shell.

## 3. Create the deploy SSH key

Generate a **new** key pair for this purpose only; do not reuse an existing personal or
server key.

```bash
# On a trusted workstation
ssh-keygen -t ed25519 -N '' -C 'coffy-shop demo deploy' -f coffy-deploy-demo
```

On the server, authorise the public key for `coffy-deploy` only. `restrict` disables
port/agent forwarding and PTYs, which the deploy job does not need:

```bash
sudo -u coffy-deploy install -d -m 0700 /home/coffy-deploy/.ssh
echo "restrict $(cat coffy-deploy-demo.pub)" | sudo -u coffy-deploy tee -a /home/coffy-deploy/.ssh/authorized_keys >/dev/null
sudo -u coffy-deploy chmod 0600 /home/coffy-deploy/.ssh/authorized_keys
```

Pin the host key: run `ssh-keyscan -t ed25519 <host>` from the workstation and compare
its fingerprint (`ssh-keygen -lf -` on that output) with
`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` run on the server console. Only a
matching line goes into the `COFFY_DEPLOY_KNOWN_HOSTS` secret.

Put the private key into the GitHub secret (section 5), then delete the local copy.

## 4. Add the Caddy site block

Caddy is shared with Dolmuş Takip: add a separate site block and leave every existing
block as it is. Reload, never restart.

1. Find the active config: `systemctl cat caddy` shows the `--config` file (usually
   `/etc/caddy/Caddyfile`). Check whether it uses `import` lines for per-site files.
   If Caddy is driven by a JSON config or its admin API instead of a Caddyfile, stop and
   decide the change with whoever owns that setup — do not convert it.
2. Back up: `sudo cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date -u +%Y%m%dT%H%M%SZ)`.
3. Add the contents of `caddy/coffy-shop.caddy` — appended to the Caddyfile, or as a new
   file in the imported directory if the config uses `import`.
4. Validate the **whole** config, then reload:

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   sudo systemctl reload caddy
   ```

5. If validation fails, restore the backup and validate again before reloading. Check
   that the Dolmuş Takip site still answers.

## 5. GitHub `Demo` environment

In the repository: Settings → Environments → create `Demo`. Values live only there —
never in the repository.

Secrets:

| Name | Holds |
| --- | --- |
| `COFFY_DEPLOY_SSH_PRIVATE_KEY` | Private half of the deploy key from section 3. |
| `COFFY_DEPLOY_KNOWN_HOSTS` | The verified `known_hosts` line from section 3. |
| `COFFY_DIJJI_DEPLOY_WEBHOOK_KEY` | This project's Deploy Webhook API key, generated in DIJJI project settings. |

Variables:

| Name | Holds |
| --- | --- |
| `COFFY_APP_URL` | Public HTTPS URL of the site block from section 4. |
| `COFFY_DEPLOY_HOST` | Server address the deploy job connects to. |
| `COFFY_DEPLOY_USER` | The deploy account created by `provision.sh`. |
| `COFFY_DEPLOY_PATH` | Must be `/opt/coffy-shop`, matching the root-owned deploy wrapper. |
| `COFFY_PORT` | The port in the env file. |
| `COFFY_DATABASE_PATH` | The same database path as in the env file. |

After verification, rollback (if needed), and SSH cleanup, the deploy job posts
`{sha: GITHUB_SHA, state: success|failure, environment: Demo}` to
`https://app.dijji.ai/_api/webhooks/deploy` using the project key in `X-Api-Key`.
Success is sent only after the exact merged SHA passes HTTPS health/version checks.
A failed build skips every upload and activation step and sends a failure signal.
HTTP 200 with `received: true` confirms notification acceptance; DIJJI's run state
confirms that E2E started. A notification error fails the workflow without rolling
back a healthy release or sending a second failure signal. After resolving it,
retry the notification for the same SHA and actual deployment result.

## How a deploy runs

The deploy job uploads the release to a temporary name under `releases/`, renames it to
`releases/<sha>`, then runs `sudo /usr/local/sbin/coffy-shop-deploy activate <sha>`.
The wrapper accepts only `activate` or `rollback` and a 40-character lowercase hex SHA,
takes every path from itself and the env file, and holds a lock (`flock`) so two deploys
never interleave. `activate`:

1. Checks the release directory and its `server.js`.
2. **Backup** — if the database exists, writes an online backup (SQLite backup API, safe
   while the old release keeps serving) to
   `/var/lib/coffy-shop/backups/coffy-<UTC time>-before-<sha>.sqlite`. On initial setup
   there is no database and no backup.
3. **Migration** — runs the new release's `src/cli/migrate.ts` as `coffy-shop`.
4. **Seed** — only when the database did not exist before this activation.
5. Records the release `current` pointed to as `previous` (unless the same SHA is
   re-activated) and switches `current` with a single rename.
6. Restarts `coffy-shop` and keeps the 5 newest releases plus `current` and `previous`.

Release code is only ever run as `coffy-shop`, never as root. Any failure exits non-zero
and the deploy job fails. The job then checks `/api/health` and `/api/version` over
HTTPS and calls `rollback <sha>` if anything after activation fails.

## Backups

- Automatic: one backup before every migration (see above). Backups are not deleted
  automatically; review the directory periodically and remove old files:
  `sudo ls -lt /var/lib/coffy-shop/backups`.
- Manual, while the service runs (the destination must be a new absolute file):

  ```bash
  cd /opt/coffy-shop/current
  sudo -u coffy-shop env COFFY_DATABASE_PATH=<database path> <node path> src/cli/backup.ts \
    /var/lib/coffy-shop/backups/coffy-$(date -u +%Y%m%dT%H%M%SZ)-manual.sqlite
  ```

  `<node path>` is the binary shown in `systemctl cat coffy-shop`. Never copy the live
  database file with `cp`: in WAL mode that produces an inconsistent copy.

## Migrations

Migrations run automatically on every activation, as `coffy-shop`, from the release
being activated. Each migration file commits together with its `schema_migrations`
row, so a re-run applies nothing twice, and migrations are additive so the previous
release keeps working against the new schema. To run them by hand:

```bash
cd /opt/coffy-shop/current
sudo -u coffy-shop env COFFY_DATABASE_PATH=<database path> <node path> src/cli/migrate.ts
```

If the very first activation created the database but failed before seeding, the seed
is not retried automatically; run `src/cli/seed.ts` the same way once. It only inserts
missing sample products and never changes existing rows.

## Rollback (code)

- Automatic: the deploy job runs `coffy-shop-deploy rollback <sha>` when activation,
  health or version verification fails. If `<sha>` is current, the wrapper switches back
  to the recorded previous release, forgets the record and restarts the service. If
  `<sha>` never became current (for example the migration failed), there is nothing to
  roll back and the old release is still serving. On the very first deploy there is no
  previous release and rollback fails clearly.
- Manual: `sudo /usr/local/sbin/coffy-shop-deploy rollback <sha of the current release>`
  (`readlink /opt/coffy-shop/current` shows it).

Rollback switches code only. **The database is never restored automatically**; schema
changes stay in place, which the previous release tolerates because migrations are
additive.

## Manual database restore

Only when data must go back to a backup (data loss is accepted for everything written
after that backup). Each step keeps the current data, so the restore can be undone.

1. Choose the backup. A file named `...-before-<sha>.sqlite` holds the data as it was
   just before `<sha>` was activated; the release that was current then matches it.
2. Check it (read-only):

   ```bash
   sudo -u coffy-shop <node path> -e "const {DatabaseSync}=require('node:sqlite'); \
     console.log(new DatabaseSync(process.argv[1],{readOnly:true}).prepare('PRAGMA integrity_check').get())" \
     /var/lib/coffy-shop/backups/<backup file>
   ```

   It must print `integrity_check: 'ok'`.
3. Stop the service: `sudo systemctl stop coffy-shop`.
4. Move the current database **and** its `-wal` and `-shm` files aside together (never
   delete them). The data directory is only accessible to `coffy-shop`, so use full paths:

   ```bash
   db=<database path>
   ts=$(date -u +%Y%m%dT%H%M%SZ)
   for f in "$db" "$db-wal" "$db-shm"; do
     if sudo test -e "$f"; then sudo -u coffy-shop mv "$f" "$f.replaced-$ts"; fi
   done
   ```

5. Put the backup in place as `coffy-shop`:
   `sudo -u coffy-shop cp /var/lib/coffy-shop/backups/<backup file> "$db"`
6. If the backup predates the current release's migrations, either run the migration
   (see Migrations) or roll the code back to the release that matches the backup.
7. Start and check: `sudo systemctl start coffy-shop`, then
   `curl -s http://127.0.0.1:3002/api/health` must return `{"status":"ok","database":"ok"}`.
8. Once the result is confirmed, the `*.replaced-<time>` files can be archived or removed.

## Not validated in the repository's CI

The repository's tests check these files statically (`bash -n` and the wrapper's
argument validation). `visudo`, `systemd-analyze verify`, `caddy validate` and running
`provision.sh` or the wrapper need the server and root; do them as described above.
