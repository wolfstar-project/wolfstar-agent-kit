# Public GitHub reads with agent-gh

`agent-gh` runs GitHub CLI read commands as the `wolfstarbot` machine account.
It never uses your own `gh` login, and it never falls back to it.
It refuses writes, raw [GraphQL](https://graphql.org), and API requests other than `GET`.

Linux and macOS run `scripts/github-public.sh`.
Windows runs `scripts/github-public.ps1` natively in PowerShell 7, with no WSL or Git Bash.
Both wrappers allow the same commands, and a test fails if their policies differ.

## Prerequisites

- The [GitHub CLI](https://cli.github.com), installed at a trusted location (see [Trusted GitHub CLI locations](#trusted-github-cli-locations)).
- A fine-grained token on `wolfstarbot`. It begins with `github_pat_`.
  Select **Public repositories** and add no account permissions.
- On Windows, [PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows) or later: `winget install --id Microsoft.PowerShell`.
  Windows PowerShell 5.1 is not supported.

Never put the token in Git, Agent instructions, or repository environment files.

`WOLFSTAR_AGENT_GITHUB_LOGIN` names another machine account, for the installers and the `--help` text.

## Install from nothing

`scripts/install.sh` (Linux and WSL) and `scripts/install.ps1` (Windows, PowerShell 7) do every step below in one run:
prerequisites, clone, `pnpm install`, `pnpm sync:context`, the token, and a final `agent-gh api user` and `agent-gh api rate_limit`.
They save the token only after GitHub confirms it belongs to `wolfstarbot`, and they keep a working token unless you confirm its replacement.
Both accept a dry run (`--dry-run`, `-DryRun`).
[The Service README](../packages/wolfstar-github-agent/README.md#install) lists their options.

## Install on Linux

`pnpm sync:context` on Linux needs `jq`, which reads the hook list from the plugin manifest.

```bash
pnpm sync:context
```

This installs `~/.local/bin/agent-gh` with the Agent instructions and hooks.
Save the token and restrict it to your account:

```bash
mkdir -p ~/.config/wolfstar-agent-kit
install -m 600 /dev/null ~/.config/wolfstar-agent-kit/github-public-token
$EDITOR ~/.config/wolfstar-agent-kit/github-public-token
```

## Install on Windows

From the repository checkout, in PowerShell 7:

```powershell
pnpm install
pnpm sync:context -- -AddToPath
agent-gh --setup-token
```

`pnpm sync:context` installs `agent-gh.ps1` in `$HOME\.local\bin`.
On Windows it installs only `agent-gh`; sync the Agent instructions and hooks from Linux or WSL.
`-AddToPath` adds that directory to your user `PATH`, once, without administrator rights.
Open a new PowerShell window afterwards.
PowerShell finds `agent-gh.ps1` on `PATH`, so you run it as `agent-gh`.

`agent-gh --setup-token` asks for the token without echoing it.
It creates `$HOME\.config\wolfstar-agent-kit\github-public-token` with an ACL that grants access to your account, `SYSTEM`, and `Administrators` only, and disables inheritance.
It refuses to overwrite an existing token. Rotate one with `agent-gh --setup-token --replace`.
An ordinary `agent-gh` command never creates the token file.

Running `pnpm sync:context` again changes nothing unless the wrapper changed, and it never touches the token.
`pnpm check:context` reports a stale `agent-gh.ps1`.

## Use

```powershell
agent-gh repo view wolfstar-project/stars-components
agent-gh issue list -R wolfstar-project/stars-components
agent-gh pr view 236 -R wolfstar-project/stars-components
agent-gh api user --jq .login     # Confirms the account
agent-gh api rate_limit           # Shows its quota
```

These are refused, and exit with status 1 before the token is read:

```powershell
agent-gh issue create -R wolfstar-project/stars-components
agent-gh pr merge 236 -R wolfstar-project/stars-components
agent-gh api graphql -f query='query { viewer { login } }'
agent-gh api repos/OWNER/REPO -X DELETE
```

The allowed reads are `pr view|list|checks|diff`, `issue view|list`, `repo view|list`, `search code|commits|issues|prs|repos`, `run view|list|watch|download`, `release view|list|download`, and `api` with `GET`.
`api` field options keep `GET` rather than turning the request into a `POST`.
Headers, `--hostname`, `--input`, and `--web` are refused.

Every argument reaches `gh` unchanged, and `agent-gh` exits with the status `gh` returns.

## How the credential stays isolated

For the `gh` process only, `agent-gh` sets `GH_TOKEN` from the token file, `GH_HOST=github.com`, `GH_PROMPT_DISABLED=1`, and `GH_CONFIG_DIR` to `~/.config/wolfstar-agent-kit/gh-public`.
It removes `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, and `GH_DEBUG`.
The separate config directory keeps your own `gh auth` login out of reach.

On Linux the wrapper `exec`s `gh`, so nothing reaches your shell.
On Windows the script runs inside your PowerShell session, so it sets those variables for the call and restores every previous value afterwards, including on Ctrl+C.
It never changes user or machine environment variables.

The token file must be a plain file, not a link, and owner-only:

| Platform | Accepted                                                                       |
| -------- | ------------------------------------------------------------------------------ |
| Linux    | Mode `600`, owned by you                                                       |
| Windows  | Owner and every allow rule are you, `SYSTEM`, or `Administrators`, nobody else |

The wrapper prevents accidental writes and credential selection.
It does not isolate processes running under the same operating system account.

## Trusted GitHub CLI locations

`agent-gh` never runs a `gh` from `PATH` or the working directory, so a repository cannot ship a `gh` that captures the token.
It runs the first of these that exists:

| Linux                                            | Windows (`gh.exe` only)                                  |
| ------------------------------------------------ | -------------------------------------------------------- |
| `/run/agent/host-tools/gh`                       | `$HOME\.local\share\wolfstar-agent-kit\tools\bin\gh.exe` |
| `~/.local/share/wolfstar-agent-kit/tools/bin/gh` | `$HOME\.local\bin\gh.exe`                                |
| `~/.local/bin/gh`                                | `C:\Program Files\GitHub CLI\gh.exe` (winget, MSI)       |
| `/usr/local/bin/gh`, `/usr/bin/gh`, `/bin/gh`    | `C:\Program Files (x86)\GitHub CLI\gh.exe`               |
|                                                  | `$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe`           |
|                                                  | `$HOME\scoop\apps\gh\current\bin\gh.exe`                 |

On Windows a `.cmd`, `.bat`, or `.ps1` at one of those paths is skipped.

## Windows and Linux differences

- Windows installs `agent-gh` only. Linux also installs the Agent instructions, hooks, and the worker copy at `~/.local/share/wolfstar-agent-kit/github-bin/gh`.
- Windows checks the file ACL; Linux checks mode `600`.
- Windows creates the token with `agent-gh --setup-token`; Linux uses `install -m 600`.
- PowerShell removes a bare `--` before a script sees its arguments, so `agent-gh` on Windows never receives one. No allowed command needs it.
- PowerShell passes `gh` output through its pipeline as text, so `agent-gh api ... | ConvertFrom-Json` works. For binary downloads use `release download` or `run download`, which write files directly.

## Troubleshooting

| Message                                         | Fix                                                                                                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `The public GitHub token is missing`            | Run `agent-gh --setup-token` (Windows) or create the file as above (Linux).                                                                                                                           |
| `Use a fine-grained token ...`                  | The file holds a classic `ghp_` token or other text. Create a fine-grained token and replace it.                                                                                                      |
| `... readable by other accounts` (Windows)      | Run `agent-gh --setup-token --replace` to rewrite the file with an owner-only ACL.                                                                                                                    |
| `... needs owner-only access` (Linux)           | Run `chmod 600 ~/.config/wolfstar-agent-kit/github-public-token`.                                                                                                                                     |
| `The GitHub CLI is missing`                     | Install it at a trusted location, for example `winget install --id GitHub.cli`.                                                                                                                       |
| `agent-gh` is not recognized (Windows)          | Run `pnpm sync:context -- -AddToPath` and open a new window, or add `$HOME\.local\bin` to `PATH`.                                                                                                     |
| `... is not digitally signed` (Windows)         | Your execution policy is `AllSigned`, or the checkout came from a download: run `Unblock-File` on the checkout's `scripts\*.ps1`, then sync again. `RemoteSigned`, the PowerShell 7 default, runs it. |
| `Could not start pwsh` from `pnpm sync:context` | Install PowerShell 7 and reopen the terminal.                                                                                                                                                         |
| `HTTP 401` or `Bad credentials`                 | The token expired or was revoked. Create a new one and run `agent-gh --setup-token --replace`.                                                                                                        |
| `HTTP 403` or rate limit                        | The machine account's quota is spent. Wait for `agent-gh api rate_limit` to reset; never switch to your own login.                                                                                    |

If the token fails, stop. Never switch to your own credentials to finish a public read.
