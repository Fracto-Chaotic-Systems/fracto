#!/bin/sh

set -eu

source_directory=${1:-/legacy-tiles}
destination_directory=${2:-/var/lib/fracto/tiles}

if [ ! -d "$source_directory" ]; then
  echo "Legacy tile cache not found: $source_directory" >&2
  exit 1
fi

set -- "$source_directory"/[0-9]*
if [ ! -e "$1" ]; then
  echo "No numeric tile files or directories found in $source_directory" >&2
  exit 1
fi

echo "Moving legacy tile cache from $source_directory to $destination_directory"
echo "Existing Docker-cached tiles will be preserved and removed from the legacy source."

estimate_binning=${FRACTO_MIGRATION_ESTIMATE_BINNING:-false}
bin_total=0
if [ "$estimate_binning" = "true" ]; then
  echo "Counting tile files for a binning-phase estimate..."
  bin_total=$(find "$source_directory" -type f -print | awk -F/ '{name=$NF; if (name ~ /^[0-9]+\.gz$/) count++} END {print count + 0}')
  if [ "$bin_total" -eq 0 ]; then
    echo "No numeric .gz tile files found in $source_directory" >&2
    exit 1
  fi
fi
bin_started_at=$(date +%s)
last_bin_report=$bin_started_at

moved_count=0
skipped_count=0
processed_count=0
bin_directory=$(mktemp -d)
trap 'rm -rf "$bin_directory"' EXIT HUP INT TERM
find "$source_directory" -type f -print \
  | awk -F/ '{name=$NF; if (name ~ /^[0-9]+\.gz$/) {sub(/\.gz$/, "", name); print length(name) "\t" $0}}' \
  | while IFS="	" read -r level source_file; do
      printf '%s\n' "$source_file" >> "$bin_directory/$level"
      if [ "$estimate_binning" = "true" ]; then
        bin_processed=${bin_processed:-0}
        bin_processed=$((bin_processed + 1))
        now=$(date +%s)
        if [ $((now - last_bin_report)) -ge 60 ] && [ $((bin_processed % 100)) -eq 0 ]; then
          bin_elapsed=$((now - bin_started_at))
          bin_rate=$((bin_processed * 60 / bin_elapsed))
          bin_remaining=$((bin_total - bin_processed))
          bin_eta=$(((bin_remaining * 60 / bin_rate + 59) / 60))
          echo "Binning: $bin_processed/$bin_total files; estimated time to first tile: about $bin_eta minute(s)"
          last_bin_report=$now
        fi
      fi
    done

if [ "$estimate_binning" = "true" ]; then
  bin_finished_at=$(date +%s)
  echo "Binning complete after $((bin_finished_at - bin_started_at)) second(s); beginning first tile transfer."
fi

total_files=0
for bin_file in "$bin_directory"/*; do
  [ -f "$bin_file" ] || continue
  bin_count=$(wc -l < "$bin_file")
  total_files=$((total_files + bin_count))
done
if [ "$total_files" -eq 0 ]; then
  echo "No numeric .gz tile files found in $source_directory" >&2
  exit 1
fi
started_at=$(date +%s)
last_eta_report=$started_at

for level in $(find "$bin_directory" -type f -printf '%f\n' | sort -n); do
  bin_file="$bin_directory/$level"
  if [ -f "$bin_file" ]; then
    echo "Starting level $level tiles"
    while IFS= read -r source_file; do
  relative_path=${source_file#"$source_directory"/}
  top_level=${relative_path%%/*}
  case "$top_level" in
    [0-9]*) ;;
    *) continue ;;
  esac

  destination_file="$destination_directory/$relative_path"
  mkdir -p "$(dirname "$destination_file")"
  if [ -e "$destination_file" ]; then
    rm -f "$source_file"
    skipped_count=$((skipped_count + 1))
  else
    temporary_file="$destination_file.migrating-$$"
    rm -f "$temporary_file"
    cp "$source_file" "$temporary_file"
    mv -f "$temporary_file" "$destination_file"
    rm -f "$source_file"
    moved_count=$((moved_count + 1))
  fi

  processed_count=$((processed_count + 1))
    if [ $((processed_count % 100)) -eq 0 ]; then
      echo "Processed $processed_count tile files"
      now=$(date +%s)
      if [ $((now - last_eta_report)) -ge 60 ]; then
        elapsed=$((now - started_at))
        rate_per_minute=$((processed_count * 60 / elapsed))
        if [ "$rate_per_minute" -gt 0 ]; then
          remaining=$((total_files - processed_count))
          eta_minutes=$(((remaining * 60 / rate_per_minute + 59) / 60))
          echo "Estimated time remaining: about $eta_minutes minute(s) ($processed_count/$total_files at $rate_per_minute files/minute)"
        fi
        last_eta_report=$now
      fi
    fi
    done < "$bin_file"
  fi
done

find "$source_directory" -depth -type d -empty -delete
echo "Legacy tile cache migration complete."
