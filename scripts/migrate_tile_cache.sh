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

moved_count=0
skipped_count=0
processed_count=0
current_level=
find "$source_directory" -type f -print \
  | awk -F/ '{name=$NF; if (name ~ /^[0-9]+\.gz$/) {sub(/\.gz$/, "", name); print length(name) "\t" $0}}' \
  | sort -n -k1,1 -k2,2 \
  | cut -f2- \
  | while IFS= read -r source_file; do
  relative_path=${source_file#"$source_directory"/}
  top_level=${relative_path%%/*}
  case "$top_level" in
    [0-9]*) ;;
    *) continue ;;
  esac

  shortcode=${source_file##*/}
  shortcode=${shortcode%.gz}
  level=${#shortcode}
  if [ "$level" != "$current_level" ]; then
    echo "Starting level $level tiles"
    current_level=$level
  fi

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
  fi
done

find "$source_directory" -depth -type d -empty -delete
echo "Legacy tile cache migration complete."
