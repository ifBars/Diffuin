import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Worker } from "../src/worker.js";
import type { Config } from "../src/config.js";
import type { CodexPort, GitHubPort, GitHubReadBrokerPort, Job } from "../src/types.js";
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

const githubReadBroker: GitHubReadBrokerPort = {
  openSession: () => ({
    url: "http://127.0.0.1:12345/mcp",
    token: "session-token",
    repositories: ["ifBars/S1API"],
    close: () => undefined,
  }),
};

describe("Worker review delivery", () => {
  it("edits the progress comment and posts native inline findings", async () => {
    const updates: string[] = [];
    const inline: Array<{ path: string; line: number; body: string }> = [];
    let finished = "";
    let readSessionClosed = false;
    const trackedReadBroker: GitHubReadBrokerPort = {
      openSession: () => ({
        url: "http://127.0.0.1:12345/mcp",
        token: "session-token",
        repositories: ["ifBars/S1API"],
        close: () => { readSessionClosed = true; },
      }),
    };
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
      updateIssue: async () => undefined,
      createPullRequest: async () => ({ number: 1, url: "https://example.test/1" }),
    };
    const codex: CodexPort = {
      run: async (_directory, _prompt, options) => {
        assert.equal(options.reasoningEffort, "medium");
        assert.equal(options.githubReadSession?.token, "session-token");
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

    await new Worker(config, store, github, codex, workspaces, references, trackedReadBroker).process(job);

    assert.equal(finished, "succeeded");
    assert.equal(inline.length, 1);
    assert.match(updates[0] ?? "", /## Diffuin review/);
    assert.match(updates[0] ?? "", /AI notice/);
    assert.doesNotMatch(updates[0] ?? "", /truncated/);
    assert.equal(readSessionClosed, true);
  });

  it("turns an open-PR issue follow-up into a patch against the requested branch", async () => {
    const implementationJob: Job = {
      ...job,
      kind: "issue",
      mode: "auto",
      task: "Open a PR against stable to fix the persistence issue.",
    };
    let preparedSource = "";
    let pullRequestBase = "";
    let pullRequestTitle = "";
    let pullRequestBody = "";
    let finished = "";
    const updates: string[] = [];
    const github: GitHubPort = {
      getActorPermission: async () => "write",
      addReaction: async () => undefined,
      comment: async () => 88,
      updateComment: async (_request, _commentId, body) => { updates.push(body); },
      reviewPullRequest: async () => undefined,
      getDefaultBranch: async () => "beta",
      getIssue: async () => ({
        title: "Relationship persistence bug",
        body: "The saved relationship value resets after reload.",
        comments: [
          { id: 2, author: "diffuin[bot]", body: "Prior research identified a sentinel-value overwrite." },
          { id: 3, author: "ifBars", body: implementationJob.task },
        ],
      }),
      getPullRequest: async () => { throw new Error("not a pull request"); },
      getInstallationToken: async () => "token",
      updateIssue: async () => undefined,
      createPullRequest: async (_request, input) => {
        pullRequestBase = input.base;
        pullRequestTitle = input.title;
        pullRequestBody = input.body;
        return { number: 44, url: "https://example.test/pull/44" };
      },
    };
    const codex: CodexPort = {
      run: async (_directory, prompt) => {
        assert.match(prompt, /Prior research identified a sentinel-value overwrite/);
        assert.match(prompt, /implement-issue[\\/]SKILL\.md/);
        return {
          finalResponse: JSON.stringify({
            ...JSON.parse(response),
            kind: "response",
            verdict: "not_applicable",
            findings: [],
            summary: "Implemented the narrow persistence repair and focused regression coverage.",
            pullRequestTitle: "Fix custom NPC relationship persistence",
            closesIssue: true,
          }),
          threadId: "thread",
        };
      },
    };
    const store = {
      finish: (_id: string, status: string) => { finished = status; },
    } as unknown as JobStore;
    const workspaces = {
      prepare: async (input: { sourceRef: string }) => {
        preparedSource = input.sourceRef;
        return { path: "C:/temp/work", branch: "diffuin/test", remoteUrl: "https://example.test/repo.git" };
      },
      hasChanges: async () => true,
      readPatch: async () => "diff --git a/file b/file",
      commitAndPush: async () => "commit-sha",
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

    await new Worker(config, store, github, codex, workspaces, references, githubReadBroker).process(implementationJob);

    assert.equal(preparedSource, "stable");
    assert.equal(pullRequestBase, "stable");
    assert.equal(pullRequestTitle, "Fix custom NPC relationship persistence");
    assert.match(pullRequestBody, /Closes #12/);
    assert.equal(finished, "succeeded");
    assert.equal(updates.at(-1), "Diffuin opened https://example.test/pull/44");
  });

  it("polishes a basic issue before posting its investigation", async () => {
    const issueJob: Job = { ...job, kind: "issue", mode: "investigate", task: "Investigate this issue." };
    let updatedIssue: { title: string; body: string } | null = null;
    let finalComment = "";
    const github: GitHubPort = {
      getActorPermission: async () => "write",
      addReaction: async () => undefined,
      comment: async () => 90,
      updateComment: async (_request, _commentId, body) => { finalComment = body; },
      reviewPullRequest: async () => undefined,
      getDefaultBranch: async () => "stable",
      getIssue: async () => ({ title: "npc broken", body: "npc walks inside" }),
      getPullRequest: async () => { throw new Error("not a pull request"); },
      updateIssue: async (_request, input) => { updatedIssue = input; },
      getInstallationToken: async () => "token",
      createPullRequest: async () => ({ number: 1, url: "https://example.test/1" }),
    };
    const codex: CodexPort = {
      run: async () => ({
        finalResponse: JSON.stringify({
          ...JSON.parse(response),
          kind: "response",
          verdict: "not_applicable",
          findings: [],
          summary: "The custom NPC destination policy is the leading static seam.",
          issuePolish: {
            needed: true,
            title: "[BUG] Custom NPC enters owned properties",
            body: "### Summary\n\nA custom NPC enters an owned property while approaching the player.",
            reason: "The original report lacked actionable structure.",
          },
        }),
        threadId: "thread",
      }),
    };
    const store = { finish: () => undefined } as unknown as JobStore;
    const workspaces = {
      prepare: async () => ({ path: "C:/temp/work", branch: "diffuin/test", remoteUrl: "https://example.test/repo.git" }),
      hasChanges: async () => false,
      cleanup: async () => undefined,
    } as unknown as GitWorkspace;
    const references = {
      prepare: async () => ({ skillPath: "C:/skills/schedule-one-modding", warnings: [] }),
    } as unknown as ScheduleOneReferenceWorkspace;
    const config = {
      port: 8787, githubAppId: 1, githubPrivateKey: "key", githubWebhookSecret: "test-webhook-secret",
      handle: "Diffuin", allowedRepositories: new Set(["ifbars/s1api"]), dataDir: "C:/temp/data",
      codexModel: "gpt-5.6-luna", allowedCodexModels: new Set(["gpt-5.6-luna"]),
      codexReasoningEffort: "max" as const, autoReasoningRouting: true, jobPollIntervalMs: 1000,
      scheduleOneSkillPath: "C:/skills/schedule-one-modding",
      scheduleOneCodeArchiverUrl: "https://example.test/archive.git",
    } satisfies Config;

    await new Worker(config, store, github, codex, workspaces, references, githubReadBroker).process(issueJob);

    assert.deepEqual(updatedIssue, {
      title: "[BUG] Custom NPC enters owned properties",
      body: "### Summary\n\nA custom NPC enters an owned property while approaching the player.",
    });
    assert.match(finalComment, /polished the issue description/);
    assert.match(finalComment, /## Issue investigation/);
  });
});
