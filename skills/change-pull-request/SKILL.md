---
name: change-pull-request
description: Apply authorized changes to an existing Schedule One modding pull request. Use when the maintainer asks to add, remove, move, rename, replace, simplify, fix, refactor, or otherwise alter the PR.
---

# Change a Pull Request

Treat the latest authorized request as a code-delivery contract. Read the PR body, complete base-to-head diff, prior conversation, and relevant surrounding code before editing.

1. Interpret the requested outcome from the whole message instead of relying on a fixed verb list.
2. Start from the checked-out PR head and preserve the PR's existing intent, base-branch compatibility, and unrelated work.
3. Make only the requested changes and the smallest supporting test or documentation updates needed for correctness.
4. Run focused validation first, followed by the appropriate repository build and test gates.
5. Leave the worktree changed only by the intended follow-up. Diffuin handles commit and push after the run.

Do not commit, push, create another pull request, or rewrite history. Do not claim game or runtime validation that was not performed. If the requested change conflicts with the PR or is genuinely blocked, return the exact conflict or blocker instead of making speculative edits.
