import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPrompt } from "../src/prompt.js";
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
  warnings: [],
};

describe("buildPrompt", () => {
  it("frames PR work as source-backed review without runtime claims", () => {
    const prompt = buildPrompt(
      job,
      pullRequest,
      pullRequest,
      references,
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
    assert.match(prompt, /Do not edit files for review, explanation, investigation, or planning requests/);
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
      { skillPath: references.skillPath, warnings: ["Beta game source unavailable: timeout"] },
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
});
