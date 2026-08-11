import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CodexRoutingAdvisor, shouldConsultRoutingAdvisor } from "../src/routing-advisor.js";
import type { Config } from "../src/config.js";
import type { ExecutionRoute } from "../src/routing.js";
import type { IssueContext, Job, PullRequestContext } from "../src/types.js";

const config = {
  allowedCodexModels: new Set(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.3-codex-spark"]),
  dataDir: "C:/data",
  routingAdvisorModel: "gpt-5.6-luna",
  routingAdvisorTimeoutMs: 30_000,
  sparkModels: new Set(["gpt-5.3-codex-spark"]),
  sparkReasoningEffort: "medium" as const,
} satisfies Pick<
  Config,
  "allowedCodexModels" | "dataDir" | "routingAdvisorModel" | "routingAdvisorTimeoutMs" |
  "sparkModels" | "sparkReasoningEffort"
>;

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

const issue: IssueContext = { title: "Review API change", body: "Check compatibility." };
const pullRequest: PullRequestContext = {
  ...issue,
  baseBranch: "stable",
  headBranch: "feature",
  headSha: "abc",
  headRepository: "ifBars/S1API",
  additions: 300,
  deletions: 50,
  changedFiles: 5,
  files: ["src/api.ts"],
};
const baseline: ExecutionRoute = {
  mode: "review",
  model: "gpt-5.6-terra",
  reasoningEffort: "high",
  reason: "ordinary pull request",
};

describe("CodexRoutingAdvisor", () => {
  it("uses a confident allowed route and preserves the mode", async () => {
    const advisor = new CodexRoutingAdvisor(config, async (prompt, outputSchema) => {
      assert.match(prompt, /Do not use tools/);
      assert.doesNotMatch(prompt, /secret|token/i);
      assert.deepEqual(
        (outputSchema as { properties: { model: { enum: string[] } } }).properties.model.enum,
        [...config.allowedCodexModels].sort(),
      );
      return JSON.stringify({
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
        confidence: "high",
        reasonCode: "risk",
      });
    });

    const route = await advisor.advise(job, issue, pullRequest, baseline);
    assert.deepEqual(route, {
      mode: "review",
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      reason: "Luna advisor: risk (high); baseline ordinary pull request",
    });
  });

  it("ignores low-confidence advice", async () => {
    const advisor = new CodexRoutingAdvisor(config, async () => JSON.stringify({
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      confidence: "low",
      reasonCode: "balanced",
    }));
    assert.equal(await advisor.advise(job, issue, pullRequest, baseline), null);
  });

  it("keeps Spark at its provider default", async () => {
    const advisor = new CodexRoutingAdvisor(config, async () => JSON.stringify({
      model: "gpt-5.3-codex-spark",
      reasoningEffort: "high",
      confidence: "medium",
      reasonCode: "speed",
    }));
    assert.equal(
      (await advisor.advise(job, issue, pullRequest, baseline))?.reasoningEffort,
      "medium",
    );
  });

  it("enforces a high floor for coupled work", async () => {
    const advisor = new CodexRoutingAdvisor(config, async () => JSON.stringify({
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      confidence: "high",
      reasonCode: "complexity",
    }));
    const route = await advisor.advise(
      { ...job, kind: "issue", mode: "implement" },
      issue,
      null,
      { ...baseline, mode: "implement", reasoningEffort: "xhigh", reason: "coupled implementation" },
    );
    assert.equal(route?.reasoningEffort, "high");
  });

  it("rejects a disallowed model", async () => {
    const advisor = new CodexRoutingAdvisor(config, async () => JSON.stringify({
      model: "not-allowed",
      reasoningEffort: "medium",
      confidence: "high",
      reasonCode: "balanced",
    }));
    await assert.rejects(() => advisor.advise(job, issue, pullRequest, baseline), /disallowed model/);
  });
});

describe("shouldConsultRoutingAdvisor", () => {
  it("consults only ambiguous deterministic routes", () => {
    assert.equal(shouldConsultRoutingAdvisor(job, baseline), true);
    assert.equal(
      shouldConsultRoutingAdvisor({ ...job, requestedModel: "gpt-5.6-sol" }, baseline),
      false,
    );
    assert.equal(
      shouldConsultRoutingAdvisor(job, { ...baseline, reason: "speed-prioritized review; ordinary pull request" }),
      false,
    );
    assert.equal(
      shouldConsultRoutingAdvisor(job, { ...baseline, reasoningEffort: "max", reason: "large or high-risk pull request" }),
      false,
    );
  });
});
