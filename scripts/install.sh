#!/usr/bin/env bash
# Installs agent-gh from nothing on Linux, natively or in WSL.
#
# It checks the prerequisites, clones this repository unless it already runs
# from a checkout, installs the root package, runs `pnpm sync:context`, saves
# the public GitHub token after GitHub confirms its login, and checks the result
# with agent-gh itself.
#
# Running it again changes nothing that is already right. It never replaces a
# working token without confirmation, and it never prints the token, passes it
# as an argument, or leaves it in the environment of a child process.
set -euo pipefail

# The Node floor: engines.node in packages/wolfstar-github-agent/package.json,
# which CI also runs. --experimental-strip-types itself needs 22.6.
# scripts/install.test.ts keeps this equal to the engines field.
min_node=24.0.0
repo_url=${WOLFSTAR_AGENT_KIT_REPO:-https://github.com/wolfstar-project/wolfstar-agent-kit.git}
expected_login=${WOLFSTAR_AGENT_GITHUB_LOGIN:-wolfstarbot}
# Only the token check reads this. agent-gh itself always talks to github.com.
github_api=${WOLFSTAR_AGENT_GITHUB_API:-https://api.github.com}
token_dir="$HOME/.config/wolfstar-agent-kit"
token_file="$token_dir/github-public-token"
bin_dir="$HOME/.local/bin"
agent_gh="$bin_dir/agent-gh"

# Take the token out of the environment before anything starts, so neither
# git, pnpm, nor the sync scripts inherit it. The shell variable is not exported.
supplied_token=${WOLFSTAR_AGENT_GITHUB_TOKEN-}
unset WOLFSTAR_AGENT_GITHUB_TOKEN

usage() {
  cat <<EOF
Usage: scripts/install.sh [options]

Install agent-gh for public GitHub reads as $expected_login.

Options:
  --dir PATH        Checkout to use or clone into.
                    Default: the checkout this script runs from, else ~/pkg/wolfstar-agent-kit.
  --skip-clone      Never clone. Fail unless a checkout already exists.
  --replace-token   Replace a working saved token without asking.
  --dry-run         Check prerequisites and print each change instead of making it.
  -h, --help        Show this help.

Environment:
  WOLFSTAR_AGENT_GITHUB_TOKEN   The fine-grained token. Without it, the script asks for it, hidden.
  WOLFSTAR_AGENT_GITHUB_LOGIN   The account the token must belong to. Default: wolfstarbot.
  WOLFSTAR_AGENT_KIT_DIR        Same as --dir.
  WOLFSTAR_AGENT_KIT_REPO       Repository to clone. Default: $repo_url.
  WOLFSTAR_AGENT_GITHUB_API     API the token check calls, for tests. Default: https://api.github.com.
EOF
}

say() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

dry_run=0
skip_clone=0
replace_token=0
target_dir=${WOLFSTAR_AGENT_KIT_DIR-}
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --skip-clone) skip_clone=1 ;;
    --replace-token) replace_token=1 ;;
    --dir)
      [ $# -ge 2 ] && [ -n "$2" ] || fail '--dir needs a path.'
      target_dir=$2
      shift
      ;;
    --dir=*) target_dir=${1#--dir=} ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) fail "Unknown option: $1. Run with --help." ;;
  esac
  shift
done

scratch=''
staged_token=''
cleanup() {
  [ -z "$staged_token" ] || rm -f "$staged_token"
  [ -z "$scratch" ] || rm -rf "$scratch"
}
trap cleanup EXIT

# Prints a command, or runs it.
run() {
  if [ "$dry_run" = 1 ]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

version_at_least() {
  [ "$(printf '%s\n' "$2" "$1" | sort -V | head -n 1)" = "$2" ]
}

is_wsl() {
  [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null
}

has_tty() {
  { : </dev/tty; } 2>/dev/null
}

# Asks a yes or no question on the terminal. No terminal means no.
confirm() {
  local answer=''
  has_tty || return 1
  printf '%s [y/N] ' "$1" >/dev/tty
  IFS= read -r answer </dev/tty || return 1
  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
}

package_field() {
  node -e 'const value = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; if (typeof value === "string") process.stdout.write(value)' "$1" "$2"
}

is_checkout() {
  local dir=$1
  [ -f "$dir/package.json" ] && [ -f "$dir/scripts/agent-context-platform.ts" ] \
    && git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    && [ "$(package_field "$dir/package.json" name 2>/dev/null)" = wolfstar-agent-kit ]
}

# agent-gh runs only a gh at one of these paths, never one from PATH. Keep the
# list equal to the one in scripts/github-public.sh.
trusted_gh() {
  local candidate
  for candidate in /run/agent/host-tools/gh "$HOME/.local/share/wolfstar-agent-kit/tools/bin/gh" "$HOME/.local/bin/gh" /usr/local/bin/gh /usr/bin/gh /bin/gh; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

check_prerequisites() {
  local missing=() node_version
  [ "$(uname -s)" = Linux ] || fail 'install.sh supports Linux and WSL. On Windows, run scripts/install.ps1 in PowerShell 7.'
  if [ -r /etc/os-release ] && ! grep -qi '^ID=ubuntu' /etc/os-release; then
    warn 'This installer is tested on Ubuntu. The package hints below use apt.'
  fi
  [ "${BASH_VERSINFO[0]}" -ge 4 ] || missing+=('bash 4 or later')
  command -v git >/dev/null 2>&1 || missing+=('git: sudo apt install git')
  command -v curl >/dev/null 2>&1 || missing+=('curl: sudo apt install curl')
  # pnpm sync:context reads the hook list from the plugin manifest with jq.
  command -v jq >/dev/null 2>&1 || missing+=('jq: sudo apt install jq')
  if ! command -v node >/dev/null 2>&1; then
    missing+=("Node.js $min_node or later: https://nodejs.org/en/download")
  else
    node_version=$(node -p 'process.versions.node')
    if ! version_at_least "$node_version" "$min_node"; then
      missing+=("Node.js $min_node or later, found $node_version: https://nodejs.org/en/download")
    elif ! node --experimental-strip-types -e '' >/dev/null 2>&1; then
      missing+=("Node.js that accepts --experimental-strip-types, found $node_version")
    fi
  fi
  # Node 25 stopped bundling Corepack.
  command -v corepack >/dev/null 2>&1 || missing+=('corepack: npm install --global corepack')
  trusted_gh >/dev/null || missing+=('GitHub CLI at a trusted path such as /usr/bin/gh: sudo apt install gh (agent-gh ignores PATH and the snap at /snap/bin/gh)')
  if [ "${#missing[@]}" -gt 0 ]; then
    printf 'error: missing prerequisites:\n' >&2
    printf '  - %s\n' "${missing[@]}" >&2
    exit 1
  fi
  say "Prerequisites: git, curl, jq, Node.js $node_version, corepack, gh at $(trusted_gh)."
}

# Sets repo_dir to the checkout to use, cloning it when needed.
resolve_checkout() {
  local script_root='' top=''
  if [ -n "$target_dir" ]; then
    [[ "$target_dir" == /* ]] || target_dir="$PWD/$target_dir"
    if is_checkout "$target_dir"; then
      repo_dir=$target_dir
    elif [ "$skip_clone" = 1 ]; then
      fail "No wolfstar-agent-kit checkout at $target_dir. Drop --skip-clone to clone it."
    else
      clone_into "$target_dir"
    fi
    return
  fi
  if [ -f "${BASH_SOURCE[0]}" ]; then
    script_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  fi
  top=$(git rev-parse --show-toplevel 2>/dev/null || true)
  if [ -n "$script_root" ] && is_checkout "$script_root"; then
    repo_dir=$script_root
  elif [ -n "$top" ] && is_checkout "$top"; then
    repo_dir=$top
  elif [ "$skip_clone" = 1 ]; then
    fail 'Not inside a wolfstar-agent-kit checkout. Pass --dir PATH, or drop --skip-clone to clone it.'
  else
    clone_into "$HOME/pkg/wolfstar-agent-kit"
  fi
}

clone_into() {
  local dir=$1
  if [ -e "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
    fail "$dir exists and is not a wolfstar-agent-kit checkout. Choose another --dir."
  fi
  say "Cloning $repo_url into $dir."
  run mkdir -p "$(dirname "$dir")"
  run git clone -- "$repo_url" "$dir"
  repo_dir=$dir
}

warn_on_windows_drive() {
  is_wsl || return 0
  say 'Running in WSL.'
  case "$repo_dir" in
    /mnt/[A-Za-z]/*)
      warn "$repo_dir is on a Windows drive. pnpm is slow there and file modes are unreliable. Prefer a path under your WSL home, such as ~/pkg."
      ;;
  esac
}

install_packages() {
  local spec version current=''
  if [ "$dry_run" = 1 ] && [ ! -f "$repo_dir/package.json" ]; then
    say 'Would enable pnpm at the packageManager version from the cloned package.json.'
    run corepack enable pnpm
    run corepack install --global 'pnpm@<packageManager version>'
    run corepack pnpm install --frozen-lockfile --filter wolfstar-agent-kit
    run corepack pnpm sync:context
    return
  fi
  spec=$(package_field "$repo_dir/package.json" packageManager)
  [[ "$spec" == pnpm@* ]] || fail "package.json names no pnpm in packageManager: ${spec:-nothing}"
  version=${spec#pnpm@}
  version=${version%%+*}
  # Corepack downloads the pinned pnpm without asking.
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  # Ask outside the checkout: inside it, a Corepack shim always answers with
  # the packageManager version. A shim also downloads pnpm to answer, so a dry
  # run never asks.
  if [ "$dry_run" = 0 ] && command -v pnpm >/dev/null 2>&1; then
    current=$(cd / && pnpm --version 2>/dev/null || true)
  fi
  if [ "$current" = "$version" ]; then
    say "pnpm $version is active."
  else
    say "Activating pnpm $version through Corepack."
    # A system Node keeps its bin directory root owned, so fall back to ~/.local/bin.
    if [ "$dry_run" = 1 ]; then
      run corepack enable pnpm
      say 'If the Node bin directory is not writable, it falls back to:'
    fi
    if [ "$dry_run" = 1 ] || ! corepack enable pnpm >/dev/null 2>&1; then
      run mkdir -p "$bin_dir"
      run corepack enable --install-directory "$bin_dir" pnpm
    fi
    # Makes this version the default outside any project too.
    run corepack install --global "pnpm@$version"
  fi
  cd "$repo_dir"
  # Corepack runs the packageManager version whatever pnpm is first on PATH.
  # agent-gh needs the root package only. The workspace packages need native
  # toolchains that this install has no use for, as the Windows CI job shows.
  run corepack pnpm install --frozen-lockfile --filter wolfstar-agent-kit
  say 'Running pnpm sync:context. It also installs the Agent instructions in ~/.claude and ~/.codex, the hooks, and the global git commit-msg hook.'
  run corepack pnpm sync:context
}

valid_token_format() {
  [[ "$1" =~ ^github_pat_[A-Za-z0-9_]+$ ]]
}

# Asks GitHub who a token belongs to. Sets token_login. Returns 0 when GitHub
# answered, 2 when it rejected the token, and 1 when it could not be asked.
# The token reaches curl on stdin as a config line, never as an argument.
github_login() {
  local token=$1 status body
  token_login=''
  [ -n "$scratch" ] || scratch=$(mktemp -d)
  body="$scratch/user.json"
  if ! status=$(printf 'header = "Authorization: Bearer %s"\n' "$token" | curl --silent --show-error --config - \
    --header 'Accept: application/vnd.github+json' --header 'X-GitHub-Api-Version: 2022-11-28' \
    --max-time 30 --output "$body" --write-out '%{http_code}' "$github_api/user"); then
    return 1
  fi
  case "$status" in
    200) ;;
    401) return 2 ;;
    *)
      warn "GitHub answered HTTP $status."
      return 1
      ;;
  esac
  token_login=$(package_field "$body" login) || return 1
  [ -n "$token_login" ] || return 1
}

# Sets new_token from WOLFSTAR_AGENT_GITHUB_TOKEN or a hidden prompt.
read_new_token() {
  new_token=''
  if [ -n "$supplied_token" ]; then
    new_token=$supplied_token
  else
    has_tty || fail 'No terminal to ask for the token. Set WOLFSTAR_AGENT_GITHUB_TOKEN instead.'
    printf 'Create a fine-grained token on %s with Public repositories access and no account permissions.\n' "$expected_login" >/dev/tty
    printf 'Paste the token (hidden): ' >/dev/tty
    IFS= read -rs new_token </dev/tty || true
    printf '\n' >/dev/tty
  fi
  new_token=${new_token//[[:space:]]/}
  valid_token_format "$new_token" || fail 'Use a fine-grained token that begins with github_pat_. Nothing was saved.'
}

save_token() {
  staged_token=$(umask 077 && mktemp "$token_dir/.github-public-token.XXXXXX")
  printf '%s' "$1" >"$staged_token"
  chmod 600 "$staged_token"
  mv -f "$staged_token" "$token_file"
  staged_token=''
}

setup_token() {
  local saved='' saved_ok=0 status=0
  [ "$github_api" = https://api.github.com ] || warn "Checking tokens against $github_api, not GitHub."
  if [ -L "$token_file" ] || { [ -e "$token_file" ] && [ ! -f "$token_file" ]; }; then
    fail "The token path is not a plain file: $token_file. Remove it and run again."
  fi
  if [ "$dry_run" = 1 ]; then
    if [ -f "$token_file" ]; then
      say "Would check the saved token at $token_file and keep it if it belongs to $expected_login."
    elif [ -n "$supplied_token" ]; then
      say "Would check WOLFSTAR_AGENT_GITHUB_TOKEN with GitHub and save it to $token_file."
    else
      say "Would ask for the token, hidden, check it with GitHub, and save it to $token_file."
    fi
    run mkdir -p "$token_dir"
    run chmod 700 "$token_dir"
    return
  fi
  mkdir -p "$token_dir"
  chmod 700 "$token_dir"
  if [ -f "$token_file" ]; then
    [ "$(stat -c %u "$token_file")" = "$(id -u)" ] || fail "The saved token belongs to another account: $token_file"
    chmod 600 "$token_file"
    saved=$(<"$token_file")
    saved=${saved//[[:space:]]/}
    if ! valid_token_format "$saved"; then
      warn 'The saved token is not a fine-grained token. It will be replaced.'
    else
      github_login "$saved" || status=$?
      case "$status" in
        0)
          if [ "$token_login" = "$expected_login" ]; then
            saved_ok=1
          else
            warn "The saved token belongs to $token_login, not $expected_login. It will be replaced."
          fi
          ;;
        2) warn 'GitHub rejected the saved token. It expired or was revoked, so it will be replaced.' ;;
        *) fail 'Could not reach GitHub to check the saved token. Nothing changed. Run again when GitHub is reachable.' ;;
      esac
    fi
  fi
  if [ "$saved_ok" = 1 ]; then
    if [ -n "$supplied_token" ] && [ "${supplied_token//[[:space:]]/}" = "$saved" ]; then
      say "The saved token already belongs to $expected_login."
      return
    fi
    if [ "$replace_token" = 1 ]; then
      say "Replacing the working token for $expected_login, as --replace-token asks."
    elif confirm "A working token for $expected_login is already saved. Replace it?"; then
      :
    else
      [ -z "$supplied_token" ] || warn 'Kept the saved token and ignored WOLFSTAR_AGENT_GITHUB_TOKEN. Pass --replace-token to rotate it.'
      say "Keeping the saved token for $expected_login."
      return
    fi
  fi
  read_new_token
  status=0
  github_login "$new_token" || status=$?
  case "$status" in
    0) ;;
    2) fail 'GitHub rejected the token. Nothing was saved.' ;;
    *) fail 'Could not reach GitHub to check the token. Nothing was saved.' ;;
  esac
  [ "$token_login" = "$expected_login" ] || fail "The token belongs to $token_login, not $expected_login. Nothing was saved."
  save_token "$new_token"
  new_token=''
  say "Saved the token for $expected_login: $token_file"
}

verify() {
  local login quota
  if [ "$dry_run" = 1 ]; then
    run "$agent_gh" api user --jq .login
    run "$agent_gh" api rate_limit
    return
  fi
  [ -x "$agent_gh" ] || fail "pnpm sync:context did not install $agent_gh."
  login=$("$agent_gh" api user --jq .login) || fail 'agent-gh api user failed.'
  [ "$login" = "$expected_login" ] || fail "agent-gh reads as $login, not $expected_login."
  quota=$("$agent_gh" api rate_limit --jq '.resources.core | "\(.remaining) of \(.limit), resets \(.reset | todate)"') \
    || fail 'agent-gh api rate_limit failed.'
  say ''
  say 'agent-gh is ready.'
  say "  Login:     $login"
  say "  Quota:     $quota"
  say "  Binary:    $agent_gh"
  say "  Token:     $token_file"
  say "  Checkout:  $repo_dir"
}

# The tilde is printed for the reader, never expanded here.
# shellcheck disable=SC2088
path_hint() {
  local rc='~/.bashrc'
  case ":$PATH:" in
    *":$bin_dir:"*) return ;;
  esac
  [ "$(basename "${SHELL:-bash}")" != zsh ] || rc='~/.zshrc'
  say ''
  say "$bin_dir is not on PATH. Add this line to $rc, then open a new shell:"
  # The single quotes keep $HOME and $PATH for the shell to expand later.
  # shellcheck disable=SC2016
  say '  export PATH="$HOME/.local/bin:$PATH"'
}

main() {
  repo_dir=''
  [ "$dry_run" = 0 ] || say 'Dry run: nothing will change.'
  check_prerequisites
  resolve_checkout
  say "Checkout: $repo_dir"
  warn_on_windows_drive
  install_packages
  setup_token
  verify
  path_hint
  [ "$dry_run" = 0 ] || say 'Dry run complete. Nothing changed.'
}

main
