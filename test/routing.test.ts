import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeExecution, validateOverrides } from "../src/routing.js";
import type { Job, PullRequestContext } from "../src/types.js";

const config = {
  codexModel: "gpt-5.6-luna",
  allowedCodexModels: new Set(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]),
  codexReasoningEffort: "max" as const,
  autoReasoningRouting: true,
};

const job = {
  id: "job",
  deliveryId: "delivery",
  installationId: 1,
  repositoryId: 2,
  repository: "ifBars/S1API",
  owner: "ifBars",
  repo: "S1API",
  issueNumber: 1,
  commentId: 3,
  actor: "ifBars",
  kind: "pull_request",
  task: "review this pull request",
  mode: "review",
  closeIssueOnMerge: false,
  status: "running",
  createdAt: "now",
  updatedAt: "now",
} satisfies Job;

function pullRequest(overrides: Partial<PullRequestContext> = {}): PullRequestContext {
  return {
    title: "Small documentation fix",
    body: "Clarifies one sentence.",
    baseBranch: "beta",
    headBranch: "docs",
    headSha: "abc",
    headRepository: "ifBars/S1API",
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    files: ["S1API/docs/example.md"],
    ...overrides,
  };
}

describe("routeExecution", () => {
  it("uses medium for a small low-risk review", () => {
    assert.equal(routeExecution(job, pullRequest(), pullRequest(), config).reasoningEffort, "medium");
  });

  it("passes free-form PR review language through for agent interpretation", () => {
    const automatic = { ...job, mode: "auto" as const, task: "review this change for regressions" };
    assert.equal(routeExecution(automatic, pullRequest(), pullRequest(), config).mode, "auto");
  });

  it("passes direct PR change language through without verb routing", () => {
    const automatic = { ...job, mode: "auto" as const, task: "remove x from this PR" };
    const route = routeExecution(automatic, pullRequest(), pullRequest(), config);
    assert.equal(route.mode, "auto");
    assert.equal(route.model, "gpt-5.6-terra");
    assert.equal(route.reasoningEffort, "medium");
    assert.equal(route.reason, "bounded request");

    for (const task of ["move x beside the other helper", "How does x work in this PR?"]) {
      const followUp = routeExecution({ ...automatic, task }, pullRequest(), pullRequest(), config);
      assert.equal(followUp.model, "gpt-5.6-terra");
      assert.equal(followUp.reasoningEffort, "medium");
    }
  });

  it("escalates a large review to max", () => {
    const pr = pullRequest({ changedFiles: 25, additions: 2_000, deletions: 500 });
    assert.equal(routeExecution(job, pr, pr, config).reasoningEffort, "max");
  });

  it("routes focused plans to high and honors explicit overrides", () => {
    const planJob = { ...job, kind: "issue" as const, mode: "plan" as const };
    const route = routeExecution(planJob, { title: "Add a station", body: "Small API" }, null, config);
    assert.equal(route.model, "gpt-5.6-terra");
    assert.equal(route.reasoningEffort, "high");
    assert.equal(
      routeExecution({ ...planJob, requestedReasoningEffort: "high" }, { title: "Add a station", body: null }, null, config).reasoningEffort,
      "high",
    );
  });

  it("passes an open-PR follow-up through for agent interpretation", () => {
    const implementation = {
      ...job,
      kind: "issue" as const,
      mode: "auto" as const,
      task: "Open a PR against stable to fix the persistence issue.",
    };
    assert.equal(routeExecution(implementation, { title: "Persistence bug", body: "Saved state resets." }, null, config).mode, "auto");
  });

  it("routes source-backed issue research above a focused answer", () => {
    const investigation = {
      ...job,
      kind: "issue" as const,
      mode: "auto" as const,
      task: "Research this issue accordingly.",
    };
    const route = routeExecution(
      investigation,
      { title: "IL2CPP NPC lifecycle bug", body: "A custom NPC enters the property unexpectedly." },
      null,
      config,
    );
    assert.equal(route.mode, "auto");
    assert.equal(route.model, "gpt-5.6-terra");
    assert.equal(route.reasoningEffort, "high");
  });

  it("uses the configured fallback when automatic routing is disabled", () => {
    assert.equal(
      routeExecution(job, pullRequest(), pullRequest(), { ...config, autoReasoningRouting: false }).reasoningEffort,
      "max",
    );
  });

  it("rejects models outside the deployment allowlist", () => {
    assert.match(validateOverrides({ ...job, requestedModel: "unknown" }, config) ?? "", /not allowed/);
  });

  it("preserves explicit model and effort overrides", () => {
    const explicit = { ...job, requestedModel: "gpt-5.6-sol", requestedReasoningEffort: "xhigh" as const };
    const route = routeExecution(explicit, pullRequest(), pullRequest(), config);
    assert.equal(route.model, "gpt-5.6-sol");
    assert.equal(route.reasoningEffort, "xhigh");
  });

  it("uses the configured fallback when the preferred routed model is unavailable", () => {
    const route = routeExecution(job, pullRequest(), pullRequest(), {
      ...config,
      allowedCodexModels: new Set(["custom-deployment-model"]),
      codexModel: "custom-deployment-model",
    });
    assert.equal(route.model, "custom-deployment-model");
  });
});
