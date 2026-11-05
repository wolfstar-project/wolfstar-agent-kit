---
name: pr-evidence
description: 'Show a pull request change instead of describing it: before and after screenshots for UI work captured in a clean environment, the one snippet that is the change otherwise, and optional testing instructions when a reviewer must reproduce something by hand. Use with the pr Skill when a change is visible, at the start of UI work so the before baseline comes from the base branch, or when a reviewer needs manual steps CI cannot run.'
license: MIT
---

# PR Evidence

A reviewer should grasp what moved without reading the diff.

This Skill decides what evidence a pull request carries. [`pr`](../pr/SKILL.md) still owns the branch, the template, the AI disclosure, publication, CI, and Review. Never run `gh pr create` or edit a body outside it.

## What to show

| Change                                     | Evidence                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| UI or UX                                   | `Before` and `After` screenshots: same screen, same viewport, same state |
| CLI output, rendered email, terminal frame | Same `Before` and `After` pair                                           |
| Everything else                            | The one short snippet that is the change, never a tour of every file     |
| Lint, typecheck, test suite                | Nothing. CI reports those                                                |

Never attach a screenshot of passing tests or a green terminal.

## Capture the before first

Capture the baseline on the base branch, at the start of the work.
Rebuilding it later costs a second install, build, and walk through the app.

When work turns out to be visible after it started, stop and capture the baseline before going further.
[nuxt-frontend-review](../nuxt-frontend-review/SKILL.md) already captures the running page; reuse its capture.

## Where to capture

Capture in a clean environment with a throwaway account: a fresh browser profile for web work, an emulator or simulator for mobile work.
Never capture from a personal browser profile or device. It holds real sessions, and nothing private may leak into a pull request.
Use [browser](../browser/SKILL.md) to pick the profile.

Screenshots are published artifacts. Before attaching one, check the frame for account names, email addresses, hostnames, tokens, IDs, and message content.
Ask the user when real data cannot be avoided.

## Hosting

Follow [pr media](../pr/references/media.md). GitHub CLI `--attach` uploads the files to the pull request, so binaries never enter Git history and nothing goes to another service.

Never reuse a file name for a changed capture. GitHub caches rendered images, so a replaced file can keep showing the old picture.
Name each recapture for its revision, such as `after-<short-sha>.png`.

Lay pairs out as a two-column `Before` and `After` table.

## Where evidence goes

- **Screenshots and hand checks:** the self-identified Agent comment from `pr` Step 5. Never in the description.
- **Snippet:** the description's 📚 Description section, after the why, only when the diff alone hides the point.
- **Testing instructions:** optional. See below.

## Optional testing instructions

Omit this section by default. CI owns lint, typecheck, build, and test evidence.

Add `### 🧪 Testing instructions` to the description only when a reviewer must reproduce the change by hand and CI cannot:

- a migration against restored data,
- a browser flow behind a login or feature flag,
- an authorization boundary,
- a device, environment, or third-party integration CI does not run.

When added:

- Place it after 📚 Description and before Breaking Changes, Migration, and the AI disclosure.
- Write numbered steps a reviewer can follow cold: setup, action, expected result.
- Put commands and URLs on their own line in backticks.
- Never list `check`, `pnpm test`, lint, or typecheck as steps.
- Keep it under eight steps. Longer setup belongs in a linked doc.

A repository template that already has a testing section wins. Fill it with the same rules, or `N/A` when nothing applies.

Steps you already ran by hand also go in the Agent comment as results. The section tells the reviewer how; the comment tells them it was done.

## Linking issues

Reference issues as `Related to #NN` unless the pull request should close them.
`Closes`, `Fixes`, and `Resolves` close the issue on merge.

---

Adapted from [ArefMozafari/pr-evidence](https://github.com/ArefMozafari/pr-evidence), MIT, Copyright (c) 2026 Aref Mozafari.
