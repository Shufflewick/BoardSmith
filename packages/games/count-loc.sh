#!/bin/bash

# Count lines of code in each game folder
# Excludes: tests, node_modules, dist, lock files, config files

EXCLUDE_PATHS="node_modules dist tests .test. .spec."
EXCLUDE_FILES="package-lock.json pnpm-lock.yaml yarn.lock tsconfig.json tsconfig.node.json vite.config.ts package.json"

should_exclude() {
    local file="$1"
    for pattern in $EXCLUDE_PATHS; do
        if [[ "$file" == *"$pattern"* ]]; then
            return 0
        fi
    done
    local basename=$(basename "$file")
    for pattern in $EXCLUDE_FILES; do
        if [[ "$basename" == "$pattern" ]]; then
            return 0
        fi
    done
    return 1
}

echo "Lines of Code by Game (excluding tests, config, node_modules)"
echo "============================================================="
echo ""

for game_dir in */; do
    if [ -d "$game_dir" ]; then
        game_name="${game_dir%/}"
        ts_lines=0
        ts_files=0

        while IFS= read -r -d '' file; do
            if ! should_exclude "$file"; then
                lines=$(wc -l < "$file")
                ts_lines=$((ts_lines + lines))
                ts_files=$((ts_files + 1))
            fi
        done < <(find "$game_dir" -name "*.ts" -type f -print0 2>/dev/null)

        printf "%-15s %6d lines in %d files\n" "$game_name" "$ts_lines" "$ts_files"
    fi
done

echo ""
echo "Breakdown by file:"
echo "------------------"

for game_dir in */; do
    if [ -d "$game_dir" ]; then
        game_name="${game_dir%/}"
        echo ""
        echo "[$game_name]"
        find "$game_dir" -name "*.ts" -type f -print0 2>/dev/null | while IFS= read -r -d '' file; do
            if ! should_exclude "$file"; then
                lines=$(wc -l < "$file")
                printf "  %6d  %s\n" "$lines" "$file"
            fi
        done | sort -rn
    fi
done
