---
name: implement-issue
description: Implement Schedule One modding issues as small reviewable pull requests. Use when the maintainer asks to fix, implement, change, or open/create/raise/submit a PR, including follow-ups after an earlier investigation or plan.
---

# Implement an Issue

The latest authorized request is a code-delivery contract. A prose-only diagnosis does not satisfy a request to fix an issue or open a pull request.

1. Read the full issue conversation before editing. Reuse prior investigation as hypotheses, verify it against the checkout and available game evidence, and do not replace it with a contradictory cause without explaining the new evidence.
2. Treat the checked-out branch as the requested PR base. Preserve its compatibility and repository conventions.
3. Make the smallest patch that addresses the supported root cause. Keep Harmony patches thin, public APIs additive, and runtime-specific behavior behind internal adapters. When exposing an existing native member, use the repository's existing direct wrapper or conversion path and preserve its identity and null semantics; do not invent reflection, lookup, reconstruction, or fallback behavior without evidence that the direct path is insufficient.
4. Add or update a focused regression test only when it exercises meaningful behavior or a demonstrated failure and fits the existing test harness. Never replace unrelated coverage to make room for it. A trivial member forwarder normally needs the existing build and test gates, not a reflection-only API-shape test. Run the narrowest relevant checks, followed by the appropriate MonoMelon and Il2CppMelon build/test gates when available.
5. Leave the worktree changed only by the intended implementation. Diffuin handles commit, push, and PR creation after the run.

Do not claim game, Unity, save/load, multiplayer, Mono runtime, IL2CPP runtime, or end-to-end validation that was not performed. If implementation is genuinely blocked, return the exact blocker and evidence needed; do not disguise another investigation response as completed implementation.
