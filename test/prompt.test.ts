import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPrompt } from "../src/prompt.js";
import { buildScheduleOneProfileContext } from "../src/profiles/schedule-one.js";
import { GeneralAgentProfile } from "../src/profiles/general.js";
import type { Job, PullRequestContext, ScheduleOneReferences } from "../src/types.js";

const job: Job = {
  id: "job-1",
  status: "running",
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
  deliveryId: "delivery-1",
  installationId: 42,
  repositoryId: 7,
  repository: "ifBars/S1API",
  owner: "ifBars",
  repo: "S1API",
  issueNumber: 215,
  commentId: 99,
  actor: "maintainer",
  kind: "pull_request",
  task: "review this for dual-runtime regressions",
  mode: "review",
  closeIssueOnMerge: false,
};

const pullRequest: PullRequestContext = {
  baseBranch: "beta",
  headBranch: "feature/example",
  headSha: "abc123",
  headRepository: "ifBars/S1API",
  title: "Add example support",
  body: "Implements the requested API.",
  additions: 40,
  deletions: 8,
  changedFiles: 2,
  files: ["S1API/Example.cs"],
};

const references: ScheduleOneReferences = {
  skillPath: "/app/skills/schedule-one-modding",
  regularSourcePath: "/data/references/alternate/ScheduleOne-stripped",
  betaSourcePath: "/data/references/alternate-beta/ScheduleOne-stripped",
  assetRipperPath: "/data/references/assetripper",
  warnings: [],
};
const profile = buildScheduleOneProfileContext(references);

describe("buildPrompt", () => {
  it("frames PR work as source-backed review without runtime claims", () => {
    const prompt = buildPrompt(
      job,
      pullRequest,
      pullRequest,
      profile,
      "refs/diffuin/base",
      undefined,
      ["ifBars/S1API", "ifBars/MoreDrugs"],
    );

    assert.match(prompt, /Schedule One modding review and issue-planning agent/);
    assert.match(prompt, /Use first person only when it naturally describes your own actions, judgments, limits, or uncertainty/);
    assert.match(prompt, /Do not force sentences into repetitive "I will," "I found," or "I think" framing/);
    assert.match(prompt, /Read [\\/]app[\\/]skills[\\/]human-writing[\\/]SKILL\.md/);
    assert.match(prompt, /apply `\$human-writing` in general clarity mode/);
    assert.match(prompt, /git diff --find-renames refs\/diffuin\/base\.\.\.HEAD/);
    assert.match(prompt, /Never claim an in-game, Play Mode, Mono runtime, IL2CPP runtime/);
    assert.match(prompt, /Read \/app\/skills\/schedule-one-modding\/SKILL\.md first/);
    assert.match(prompt, /Regular stripped source: \/data\/references\/alternate/);
    assert.match(prompt, /Read-only GitHub evidence/);
    assert.match(prompt, /ifBars\/MoreDrugs/);
    assert.match(prompt, /diffuin_github/);
    assert.match(prompt, /diffuin_assetripper/);
    assert.match(prompt, /Private AssetRipper corpus: available through read-only tools/);
    assert.doesNotMatch(prompt, /\/data\/references\/assetripper/);
    assert.match(prompt, /For `answer`, `review`, `investigate`, and `plan` intents, do not edit repository files/);
    assert.match(prompt, /shortest complete implementation/);
    assert.match(prompt, /prefer fewer changed lines, files, branches, helpers, and abstractions/);
    assert.match(prompt, /preserve the native member's identity and null semantics/);
    assert.match(prompt, /Do not add reflection, name lookup, reconstructed wrappers, or fallback behavior unless/);
    assert.match(prompt, /Do not replace unrelated coverage, add a reflection-only API-shape test for a trivial forwarder/);
    assert.match(prompt, /review-pull-request[\\/]SKILL\.md/);
  });

  it("includes issue context and unavailable-reference warnings", () => {
    const issueJob = { ...job, kind: "issue" as const, task: "polish the acceptance criteria" };
    const prompt = buildPrompt(
      issueJob,
      {
        title: "Custom station support",
        body: "We need a safe builder API.",
        comments: [
          { id: 98, author: "diffuin[bot]", body: "Prior research identified the native registry seam." },
          { id: 99, author: "maintainer", body: "@Diffuin polish the acceptance criteria" },
        ],
      },
      null,
      buildScheduleOneProfileContext({
        skillPath: references.skillPath,
        warnings: ["Beta game source unavailable: timeout"],
      }),
    );

    assert.match(prompt, /issue #215: Custom station support/);
    assert.match(prompt, /We need a safe builder API/);
    assert.match(prompt, /Beta stripped source: unavailable/);
    assert.match(prompt, /Reference warning: Beta game source unavailable: timeout/);
    assert.match(prompt, /review-issue[\\/]SKILL\.md/);
    assert.match(prompt, /Prior research identified the native registry seam/);
    assert.doesNotMatch(prompt, /@Diffuin polish the acceptance criteria/);
    assert.doesNotMatch(prompt, /git diff --find-renames/);
  });

  it("passes auto PR requests through and lets the agent select a workflow", () => {
    const autoJob = { ...job, mode: "auto" as const, task: "How does x work in this PR?" };
    const prompt = buildPrompt(
      autoJob,
      pullRequest,
      pullRequest,
      profile,
      "refs/diffuin/base",
      { mode: "auto", model: "gpt-5.6-luna", reasoningEffort: "high", reason: "agent-directed request" },
    );

    assert.match(prompt, /How does x work in this PR\?/);
    assert.match(prompt, /Interpret the authorized request by meaning and context, not by matching a fixed verb list/);
    assert.match(prompt, /`review-pull-request`:/);
    assert.match(prompt, /`change-pull-request`:/);
    assert.match(prompt, /`none`: focused read-only questions/);
    assert.match(prompt, /Always return `intent`/);
    assert.match(prompt, /A question about how or why code works is normally `answer`/);
    assert.match(prompt, /A request to alter code, regardless of phrasing, is `implement`/);
  });

  it("runs the same repository workflow without Schedule One coupling in the general profile", async () => {
    const generalProfile = await new GeneralAgentProfile("/app/skills").prepare();
    const prompt = buildPrompt(
      { ...job, repository: "octo-org/example", task: "review the authentication boundary" },
      pullRequest,
      pullRequest,
      generalProfile,
      "refs/diffuin/base",
    );

    assert.match(prompt, /general-purpose repository agent/);
    assert.match(prompt, /No deployment-owned domain evidence pack is enabled/);
    assert.match(prompt, /review-pull-request[\\/]SKILL\.md/);
    assert.doesNotMatch(prompt, /Schedule One/);
    assert.doesNotMatch(prompt, /AssetRipper/);
    assert.doesNotMatch(prompt, /Mono\/IL2CPP/);
  });
});
