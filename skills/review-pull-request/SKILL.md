---
name: review-pull-request
description: Review Schedule One modding pull requests against repository and game-source contracts. Use for correctness, regression, compatibility, persistence, networking, lifecycle, API, and implementation-quality review of an existing PR.
---

# Review a Pull Request

Inspect the complete base-to-head diff and relevant surrounding code. Read the PR conversation for declared intent and prior decisions, but treat code and repository contracts as the source of truth.

- Report only actionable findings introduced by the PR. Do not manufacture quota-filling observations or generic praise.
- Prioritize correctness, lifecycle ownership, public API compatibility, persistence identity, server authority, headless safety, and Mono/IL2CPP differences.
- Anchor each finding to the tightest current right-side diff line when possible. State the concrete consequence and smallest repair.
- Distinguish proven defects from runtime risks. Missing in-game validation is not itself a defect unless the PR makes an unsupported claim or omits a required test contract.
- Keep the top-level review compact; place supporting evidence and validation in collapsed detail.
- Return no more than six findings in severity order and use complete sentences.

Do not edit repository files in this workflow.
