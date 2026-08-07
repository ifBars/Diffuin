import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeExecution, validateOverrides } from "../src/routing.js";
import type { Job, PullRequestContext } from "../src/types.js";

const config = {
  codexModel: "gpt-5.6-luna",
  allowedCodexModels: new Set(["gpt-5.6-luna", "gpt-5.6-terra"]),
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

  it("keeps free-form PR review language read-only", () => {
    const automatic = { ...job, mode: "auto" as const, task: "review this change for regressions" };
    assert.equal(routeExecution(automatic, pullRequest(), pullRequest(), config).mode, "review");
  });

  it("escalates a large review to max", () => {
    const pr = pullRequest({ changedFiles: 25, additions: 2_000, deletions: 500 });
    assert.equal(routeExecution(job, pr, pr, config).reasoningEffort, "max");
  });

  it("routes plans to xhigh and honors explicit overrides", () => {
    const planJob = { ...job, kind: "issue" as const, mode: "plan" as const };
    assert.equal(routeExecution(planJob, { title: "Add a station", body: "Small API" }, null, config).reasoningEffort, "xhigh");
    assert.equal(
      routeExecution({ ...planJob, requestedReasoningEffort: "high" }, { title: "Add a station", body: null }, null, config).reasoningEffort,
      "high",
    );
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
});
