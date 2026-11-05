---
name: review-replies
description: "Work through human review comments on the user's own pull request one thread at a time: check each claim against the code, propose the exact edit, and draft a reply in the team's language, while the user approves every edit, commit, push, and posted reply. Use when a reviewer commented, requested changes, or replied on the user's PR and they want it handled."
argument-hint: '[pull request number or URL]'
license: MIT
---

# Review Replies

One thread at a time, checked against the code before a word is said. The user decides every edit, commit, push, and reply.

## Scope

This Skill handles comments from people.

The `wolfstar-github-agent` marked comment, its Review outcome label, and scored findings belong to [`pr`](../pr/SKILL.md) Step 6. Never reply to that comment or change its label here.
A red pipeline with no review thread belongs to `pr` Step 6 as well.

## Setup

Resolve the pull request from the argument or `gh pr view --json number,url,headRefName`. Ask only when none resolves.

Mutate only in the pull request's `wt` worktree with a live claim. Read [worktree isolation](../../references/worktree-isolation.md) first.

GitHub keeps line comments, review summaries, and conversation comments apart. Fetch all three into a scratch directory and keep them; every later step reads them:

```bash
gh api --paginate --slurp "repos/OWNER/REPO/pulls/NUMBER/comments" > line-comments.json
gh api --paginate --slurp "repos/OWNER/REPO/pulls/NUMBER/reviews" > reviews.json
gh api --paginate --slurp "repos/OWNER/REPO/issues/NUMBER/comments" > conversation.json
```

Skip resolved threads, bots, and the user's own comments.

List the open threads in the reviewer's order: reviewer, `path:line`, one-line gist. Say how many. Then present the first.

## One thread at a time

Present exactly one thread, then stop for the user's word. No edits, no drafts for later threads.

Each thread message has four parts, in order:

1. **Plain words.** Three sentences, each under twenty words: what the reviewer says; what the code shows, with the file and line read; the verdict: right, right but the suggested fix breaks, or wrong.
2. **Exact edit.** The replacement text or snippet, never prose only. List any sibling file that repeats the same claim.
3. **Reply draft.** In the language and register of the team's own threads, not of this one comment. What was found, what was done. Identifiers, paths, and commands in backticks. When the reviewer is wrong: the evidence, no verdict on the person.
4. **One line** naming exactly what the user's go-ahead covers: which edit, in which file.

Before part 1, read the lines named and run the small thing the claim is about. A suggested fix is a claim too: trace whether it compiles and the test still passes.
Fetch history or run builds only when the claim is about them.

Something else found on the way is one sentence at the end, offered, never applied.

For a behavior or validation fix, read [unit-tests](../unit-tests/SKILL.md) and write the failing test first.

## After the last thread

1. **Commit.** One concern per commit, Conventional Commits per [the pr commit rules](../pr/references/conventional-commits.md). Stage a file with two concerns by hunk. Stop for the word before committing.
2. **Push.** Run `check`, then push with the word. Never amend or force push a published commit.
3. **Reply.** Post one reply per thread from the saved drafts, as the user's account, only with their word. Line comments reply in their thread:

   ```bash
   gh api "repos/OWNER/REPO/pulls/NUMBER/comments/COMMENT_ID/replies" -f body="$REPLY"
   ```

4. **Pipeline.** Follow `pr` Step 6 for the new head. When a job fails, quote the deciding log line before touching anything.

Never resolve a thread for the reviewer unless the user asks.

## Red flags

| Thought                                      | Reality                                                    |
| -------------------------------------------- | ---------------------------------------------------------- |
| "All three are small, I'll do them together" | The user reads one at a time. Batching hides the decision. |
| "The reviewer knows this code"               | Reviewers misread lines too. Read the line.                |
| "I fixed the neighbouring bug while there"   | Offered, not applied. Scope is the user's.                 |
| "The commit message belongs with the thread" | It comes after the last thread, once.                      |
| "The reviewer wrote English, so English"     | The team's own threads decide the language.                |

---

Adapted from [ArefMozafari/review-replies](https://github.com/ArefMozafari/review-replies), MIT, Copyright (c) 2026 Aref Mozafari.
