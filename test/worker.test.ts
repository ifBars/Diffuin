import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Worker } from "../src/worker.js";
import type { Config } from "../src/config.js";
import type { CodexPort, GitHubPort, Job } from "../src/types.js";
import type { GitWorkspace } from "../src/git.js";
import type { JobStore } from "../src/store.js";
import type { ScheduleOneReferenceWorkspace } from "../src/references.js";

const job: Job = {
  id: "job",
  deliveryId: "delivery",
  installationId: 1,
  repositoryId: 2,
  repository: "ifBars/S1API",
  owner: "ifBars",
  repo: "S1API",
  issueNumber: 12,
  commentId: 3,
  actor: "ifBars",
  kind: "pull_request",
  task: "review this pull request",
  mode: "review",
  status: "running",
  createdAt: "now",
  updatedAt: "now",
};

const response = JSON.stringify({
  kind: "review",
  verdict: "changes_requested",
  confidence: "high",
  summary: "One authority issue needs attention.",
  findings: [{
    severity: "P1",
    title: "Client mutation",
    path: "S1API/Example.cs",
    line: 10,
    body: "The client can mutate server state.",
    recommendation: "Move the mutation behind the server guard.",
  }],
  evidence: [],
  designChoices: [],
  phases: [],
  validationPerformed: ["Inspected the complete diff."],
  validationRemaining: ["Two-client runtime smoke test."],
  openQuestions: [],
});

describe("Worker review delivery", () => {
  it("edits the progress comment and posts native inline findings", async () => {
    const updates: string[] = [];
    const inline: Array<{ path: string; line: number; body: string }> = [];
    let finished = "";
    const github: GitHubPort = {
      getActorPermission: async () => "write",
      addReaction: async () => undefined,
      comment: async () => 77,
      updateComment: async (_request, _commentId, body) => { updates.push(body); },
      reviewPullRequest: async (_request, _body, comments) => { inline.push(...comments); },
      getDefaultBranch: async () => "beta",
      getIssue: async () => ({ title: "unused", body: null }),
      getPullRequest: async () => ({
        title: "Small fix",
        body: "A narrow change.",
        baseBranch: "beta",
        headBranch: "fix",
        headSha: "abc",
        headRepository: "ifBars/S1API",
        additions: 10,
        deletions: 2,
        changedFiles: 1,
        files: ["S1API/Example.cs"],
      }),
      getInstallationToken: async () => "token",
      createPullRequest: async () => ({ number: 1, url: "https://example.test/1" }),
    };
    const codex: CodexPort = {
      run: async (_directory, _prompt, options) => {
        assert.equal(options.reasoningEffort, "medium");
        return { finalResponse: response, threadId: "thread" };
      },
    };
    const store = {
      finish: (_id: string, status: string) => { finished = status; },
    } as unknown as JobStore;
    const workspaces = {
      prepare: async () => ({ path: "C:/temp/work", branch: "diffuin/test", remoteUrl: "https://example.test/repo.git" }),
      hasChanges: async () => false,
      cleanup: async () => undefined,
    } as unknown as GitWorkspace;
    const references = {
      prepare: async () => ({ skillPath: "C:/skills/schedule-one-modding", warnings: [] }),
    } as unknown as ScheduleOneReferenceWorkspace;
    const config: Config = {
      port: 8787,
      githubAppId: 1,
      githubPrivateKey: "test-key",
      githubWebhookSecret: "test-webhook-secret",
      handle: "Diffuin",
      allowedRepositories: new Set(["ifbars/s1api"]),
      dataDir: "C:/temp/diffuin-data",
      codexModel: "gpt-5.6-luna",
      allowedCodexModels: new Set(["gpt-5.6-luna"]),
      codexReasoningEffort: "max",
      autoReasoningRouting: true,
      jobPollIntervalMs: 1000,
      scheduleOneSkillPath: "C:/skills/schedule-one-modding",
      scheduleOneCodeArchiverUrl: "https://example.test/s1-codearchiver.git",
    };

    await new Worker(config, store, github, codex, workspaces, references).process(job);

    assert.equal(finished, "succeeded");
    assert.equal(inline.length, 1);
    assert.match(updates[0] ?? "", /## Diffuin review/);
    assert.match(updates[0] ?? "", /AI notice/);
    assert.doesNotMatch(updates[0] ?? "", /truncated/);
  });
});
