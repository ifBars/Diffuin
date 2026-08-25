# Diffuin architecture

Diffuin is moving from a Schedule One GitHub bot toward a small personal agent
gateway. The migration keeps the existing GitHub workflow operational while
extracting reusable seams in place.

## Product boundary

The core owns run orchestration, model routing, structured artifacts, safety
checks, and durable job state. Connectors own platform ingress, identity,
  authorization, conversation context, feedback events, and delivery. Profiles own deployment-wide
identity, evidence providers, validation limits, and the domain skill contract.
Repository guidance owns repository-specific behavior.

The learning layer is deliberately split between two forms of state:

- tracked `AGENTS.md` is promoted, versioned, repository-owned policy;
- SQLite memory and outcome records are scoped, attributable evidence used for
  retrieval and offline evaluation.

Shared memory requires the same write-equivalent authorization as work requests.
Review-thread replies are ingested immediately, while write-authorized thumbs
reactions are refreshed through the REST API during later repository jobs because
GitHub exposes no review-comment reaction webhook. Feedback is recorded only when
it targets a finding that Diffuin persisted at delivery time. Pull-request outcomes are recorded only when the PR
body contains a known Diffuin job identifier. Neither signal changes policy on
its own.

```text
connector event
  -> connector authorization and context
  -> repository workspace
  -> agent profile and session capabilities
  -> Codex or Spark harness
  -> structured artifact and proposed actions
  -> connector delivery
  -> attributable feedback and outcome evidence
```

## Current milestone

- GitHub remains the only enabled connector.
- `Worker` consumes an `AgentProfilePort` rather than constructing Schedule One
  context itself.
- `ScheduleOneAgentProfile` owns game-specific references, evidence guidance,
  and validation boundaries.
- `GeneralAgentProfile` uses the same repository workflow without game-specific
  context.
- The deployed default remains `schedule-one` for backward compatibility.

## Next connector seam

The next extraction should separate the GitHub job lifecycle into an ingress
adapter, a connector-neutral agent run request, and typed GitHub delivery
actions. Do not flatten platform capabilities: inline pull-request findings and
branch publication should remain GitHub actions, while Discord initially
supports messages, threads, attachments, and run control.

## Capability rule

Skills describe how to perform work. Capability providers expose tools and
evidence. Policy decides which actor and connector may use them. Installing a
skill never grants a remote user access to credentials, repositories, private
corpora, or mutation tools by itself.
