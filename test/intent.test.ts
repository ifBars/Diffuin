import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { artifactSchema } from "../src/artifact.js";
import { resolveArtifactIntent, workflowFor } from "../src/intent.js";

const artifact = artifactSchema.parse({
  intent: "answer",
  workflow: "none",
  kind: "response",
  verdict: "not_applicable",
  confidence: "high",
  summary: "The fallback preserves compatibility with older saves.",
  findings: [],
  evidence: [],
  designChoices: [],
  phases: [],
  validationPerformed: [],
  validationRemaining: [],
  openQuestions: [],
  pullRequestTitle: "",
  closesIssue: false,
  issuePolish: { needed: false, title: "", body: "", reason: "" },
});

describe("agent intent policy", () => {
  it("allows an auto request to resolve to a focused answer", () => {
    assert.equal(resolveArtifactIntent("pull_request", "auto", artifact), "answer");
  });

  it("maps PR changes to the dedicated change workflow", () => {
    assert.equal(workflowFor("pull_request", "implement"), "change-pull-request");
    assert.equal(workflowFor("issue", "implement"), "implement-issue");
  });

  it("rejects intent that conflicts with an explicit mode", () => {
    assert.throws(() => resolveArtifactIntent("pull_request", "review", artifact), /explicit review request as answer/);
  });

  it("rejects a workflow that does not match the interpreted intent", () => {
    assert.throws(
      () => resolveArtifactIntent("pull_request", "auto", { ...artifact, intent: "implement", workflow: "none" }),
      /expected change-pull-request/,
    );
  });
});
