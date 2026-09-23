#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

HOME="$test_root/home" bash "$script_dir/worktrunk-config.sh" update >/dev/null

cmp --silent "$script_dir/worktrunk.toml" "$test_root/home/.config/worktrunk/config.toml"
cmp --silent "$script_dir/repository-env-files" "$test_root/home/.config/wolfstar-agent-kit/repository-env-files"
cmp --silent "$script_dir/repository-env.sh" "$test_root/home/.local/bin/wolfstar-repository-env"
test "$(stat -c %a "$test_root/home/.config/worktrunk/config.toml")" = 644
test "$(stat -c %a "$test_root/home/.config/wolfstar-agent-kit/repository-env-files")" = 644
test "$(stat -c %a "$test_root/home/.local/bin/wolfstar-repository-env")" = 755

printf '%s\n' 'Worktrunk configuration tests passed'
