import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { artifactOutputSchema, parseArtifact, renderArtifact } from "../src/artifact.js";

const base = {
  kind: "review",
  verdict: "changes_requested",
  confidence: "high",
  summary: "The change has one authority regression.",
  findings: [{
    severity: "P1",
    title: "Client can mutate server state",
    path: "S1API/Networking/Example.cs",
    line: 42,
    body: "The new call runs on every peer and writes authoritative state.",
    recommendation: "Guard the mutation to the server-owned path.",
  }],
  evidence: ["Compared the complete base-to-head diff."],
  designChoices: [],
  phases: [],
  validationPerformed: ["Static inspection only."],
  validationRemaining: ["Two-client runtime smoke test."],
  openQuestions: [],
};

describe("Diffuin artifacts", () => {
  it("renders a compact review and native inline finding", () => {
    const artifact = parseArtifact(JSON.stringify(base));
    const rendered = renderArtifact(
      artifact,
      { mode: "review", model: "gpt-5.6-luna", reasoningEffort: "high", reason: "ordinary pull request" },
      { threadId: "thread", elapsedSeconds: 12 },
    );
    assert.match(rendered.body, /## Diffuin review/);
    assert.match(rendered.body, /1 P1/);
    assert.equal(rendered.inlineComments[0]?.line, 42);
    assert.match(rendered.inlineComments[0]?.body ?? "", /Recommended change/);
    assert.ok(rendered.body.endsWith("Verify findings and plans against the current source and runtime."));
  });

  it("rejects more than six findings instead of truncating Markdown", () => {
    assert.throws(() => parseArtifact(JSON.stringify({ ...base, findings: Array(7).fill(base.findings[0]) })));
  });

  it("keeps findings without a valid diff location in the top-level review", () => {
    const artifact = parseArtifact(JSON.stringify({
      ...base,
      findings: [{
        severity: "P2",
        title: "Lifecycle ambiguity",
        path: "",
        line: 0,
        body: "The cleanup owner is not established by the changed lines.",
        recommendation: "Document and enforce the cleanup owner.",
      }],
    }));

    const rendered = renderArtifact(
      artifact,
      { mode: "review", model: "gpt-5.6-luna", reasoningEffort: "high", reason: "ordinary pull request" },
      { threadId: "thread", elapsedSeconds: 1 },
    );
    assert.equal(rendered.inlineComments.length, 0);
    assert.match(rendered.body, /The cleanup owner is not established/);
    assert.match(rendered.body, /Document and enforce the cleanup owner/);
  });

  it("collapses supporting evidence and validation in plans", () => {
    const artifact = parseArtifact(JSON.stringify({
      ...base,
      kind: "plan",
      verdict: "not_applicable",
      findings: [],
      designChoices: ["Keep the public API runtime-neutral."],
      phases: [{ title: "API", objective: "Add the contract.", tasks: [] }],
    }));
    const rendered = renderArtifact(
      artifact,
      { mode: "plan", model: "gpt-5.6-terra", reasoningEffort: "xhigh", reason: "source-backed issue plan" },
      { threadId: "thread", elapsedSeconds: 1, includePlanImplementationAction: true },
    );

    assert.match(rendered.body, /<summary>Evidence and validation<\/summary>/);
    assert.match(rendered.body, /### Implementation/);
    assert.match(rendered.body, /<!-- diffuin:implement-plan -->/);
    assert.match(rendered.body, /- \[ \] Create a pull request to implement this plan/);
  });

  it("does not impose a hard JSON summary boundary that can cut a sentence", () => {
    assert.equal("maxLength" in artifactOutputSchema.properties.summary, false);
    const artifact = parseArtifact(JSON.stringify({ ...base, summary: `${"Evidence ".repeat(100)}supports the conclusion.` }));
    assert.match(artifact.summary, /supports the conclusion\.$/);
  });

  it("labels source-backed responses as investigations", () => {
    const artifact = parseArtifact(JSON.stringify({ ...base, kind: "response", verdict: "not_applicable", findings: [] }));
    const rendered = renderArtifact(
      artifact,
      { mode: "investigate", model: "gpt-5.6-luna", reasoningEffort: "xhigh", reason: "non-trivial source-backed investigation" },
      { threadId: "thread", elapsedSeconds: 1 },
    );
    assert.match(rendered.body, /## Issue investigation/);
    assert.match(rendered.body, /\*\*Confidence:\*\*/);
  });
});
