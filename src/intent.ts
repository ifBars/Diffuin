import type { DiffuinArtifact } from "./artifact.js";
import type { Job, TriggerKind } from "./types.js";

export function resolveArtifactIntent(
  kind: TriggerKind,
  requestedMode: Job["mode"],
  artifact: DiffuinArtifact,
): DiffuinArtifact["intent"] {
  if (requestedMode !== "auto" && artifact.intent !== requestedMode) {
    throw new Error(`Codex interpreted an explicit ${requestedMode} request as ${artifact.intent}`);
  }
  const expectedWorkflow = workflowFor(kind, artifact.intent);
  if (artifact.workflow !== expectedWorkflow) {
    throw new Error(`Codex selected workflow ${artifact.workflow} for ${artifact.intent} intent; expected ${expectedWorkflow}`);
  }
  return artifact.intent;
}

export function workflowFor(
  kind: TriggerKind,
  intent: DiffuinArtifact["intent"],
): DiffuinArtifact["workflow"] {
  if (intent === "answer") return "none";
  if (kind === "pull_request") {
    return intent === "implement" ? "change-pull-request" : "review-pull-request";
  }
  return intent === "implement" ? "implement-issue" : "review-issue";
}
