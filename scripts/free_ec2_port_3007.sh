#!/usr/bin/env bash
# Inspect nginx's legacy AI-port listener, then review/edit only its config.
set -Eeuo pipefail

MODE="${1:---inspect}"
case "$MODE" in
  --inspect|--edit) ;;
  --help) echo 'Usage: sudo bash scripts/free_ec2_port_3007.sh [--inspect|--edit]'; exit 0 ;;
  *) echo 'Use --inspect or --edit.' >&2; exit 2 ;;
esac
if [[ "$EUID" -ne 0 ]]; then
  echo 'Run this script with sudo so it can identify listeners and inspect nginx.' >&2
  exit 1
fi
for command_name in ss nginx python3 systemctl; do
  command -v "$command_name" >/dev/null || { echo "Missing command: $command_name" >&2; exit 1; }
done

listeners() {
  ss -H -ltnp4 'sport = :3007' |
    awk '$4 == "127.0.0.1:3007" || $4 == "0.0.0.0:3007" || $4 == "*:3007"'
}
owner="$(listeners)"
if [[ -z "$owner" ]]; then
  echo 'IPv4 port 127.0.0.1:3007 is free. No changes made.'
  exit 0
fi
printf 'Current conflicting listener:\n%s\n' "$owner"
if [[ "$owner" != *'"nginx"'* ]]; then
  echo 'The conflicting owner is not nginx. No process or configuration was changed.' >&2
  exit 1
fi

# Validate before editing. Never print the complete -T dump: it may contain
# private headers or other deployment configuration.
nginx -t
mapfile -t candidates < <(
  nginx -T 2>/dev/null | python3 -c '
import os, re, sys
parts = re.split(r"(?m)^# configuration file (.+):\s*$", sys.stdin.read())
seen = set()
for index in range(1, len(parts), 2):
    name, contents = parts[index], parts[index + 1]
    for match in re.finditer(r"(?m)^\s*listen\s+([^\s;]+)", contents):
        address = match.group(1)
        if address == "3007" or address.endswith(":3007"):
            filename = os.path.realpath(name)
            if "\n" in filename or not os.path.isfile(filename):
                raise SystemExit("Unsupported nginx configuration path")
            if filename not in seen:
                print(filename)
                seen.add(filename)
'
)
if [[ "${#candidates[@]}" -eq 0 ]]; then
  echo 'No conventional listen 3007 directive was found in nginx -T. No changes made.' >&2
  echo 'Inspect the nginx configuration manually; do not stop the public proxy.' >&2
  exit 1
fi
printf '\nLoaded nginx files containing a port 3007 listener:\n'
for index in "${!candidates[@]}"; do
  printf '  %s) %s\n' "$((index + 1))" "${candidates[$index]}"
done
if [[ "$MODE" == --inspect ]]; then
  echo 'Inspection only. Use --edit to back up and review a matching file.'
  exit 0
fi

printf '\nKeep the public site, TLS, and API proxy routes intact.\n'
printf 'Remove the legacy port 3007 server block if it has no other listeners.\n'
printf 'If that block also serves other ports, remove only its port 3007 listen directives.\n'
printf 'Do not leave a server block with no listen directive: nginx would default it to port 80.\n'
printf 'Select a file number to edit (or q to quit): '
read -r selection
[[ "$selection" != q ]] || exit 0
if [[ ! "$selection" =~ ^[1-9][0-9]*$ || "${#selection}" -gt 6 ]]; then
  echo 'Invalid file selection.' >&2; exit 1
fi
index=$((10#$selection - 1))
if [[ "$index" -ge "${#candidates[@]}" ]]; then echo 'Invalid file selection.' >&2; exit 1; fi
file="${candidates[$index]}"
editor="${EDITOR:-vi}"
command -v "$editor" >/dev/null || { echo "Editor not found: $editor" >&2; exit 1; }

# Backups stay outside nginx include directories, including sites-enabled/*.
backup_root="${FRACTO_NGINX_BACKUP_DIR:-/var/backups/fracto-nginx}"
install -d -m 0700 "$backup_root"
backup_directory="$(mktemp -d "$backup_root/port-3007.XXXXXXXX")"
backup="$backup_directory/original.conf"
cp -p -- "$file" "$backup"
printf '%s\n' "$file" > "$backup_directory/source-path.txt"
printf 'Backup saved in %s\n' "$backup_directory"

restore_needed=1
reload_attempted=0
restore_on_failure() {
  local result=$?
  trap - EXIT INT TERM
  if [[ "$restore_needed" == 1 ]]; then
    if cp -p -- "$backup" "$file"; then
      echo 'Restored the original nginx file after the unsuccessful edit.' >&2
      if [[ "$reload_attempted" == 1 ]]; then
        if nginx -t; then systemctl reload nginx.service || true; fi
      fi
    else
      printf 'Restore failed; the original is preserved at %s\n' "$backup" >&2
    fi
  fi
  exit "$result"
}
trap restore_on_failure EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"$editor" "$file"
nginx -t
reload_attempted=1
systemctl reload nginx.service
restore_needed=0

# Graceful reload may take a moment to retire the old listening socket.
for ((attempt=0; attempt<10; attempt++)); do
  if [[ -z "$(listeners)" ]]; then
    echo 'Port 127.0.0.1:3007 is free; nginx is still running.'
    echo 'Rerun your Fracto deployment command now.'
    exit 0
  fi
  sleep 1
done
echo 'The edit passed validation and nginx reloaded, but port 3007 is still occupied:' >&2
listeners >&2
echo 'The valid edit and backup were retained. Run --inspect again to check other matching files.' >&2
exit 1
