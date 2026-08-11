import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Worker } from "../src/worker.js";
import type { Config } from "../src/config.js";
import type { AssetRipperReadBrokerPort, CodexPort, GitHubPort, GitHubReadBrokerPort, Job } from "../src/types.js";
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
  closeIssueOnMerge: false,
  status: "running",
  createdAt: "now",
  updatedAt: "now",
};

const response = JSON.stringify({
  intent: "review",
  workflow: "review-pull-request",
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

const assetRipperReadBroker: AssetRipperReadBrokerPort = {
  openSession: async () => undefined,
};

describe("Worker review delivery", () => {
  it("edits the progress comment and posts native inline findings", async () => {
    let progressComment = "";
    const updates: string[] = [];
    const inline: Array<{ path: string; line: number; body: string }> = [];
    let finished = "";
    let readSessionClosed = false;
    let assetReadSessionClosed = false;
    const trackedReadBroker: GitHubReadBrokerPort = {
      openSession: () => ({
        url: "http://127.0.0.1:12345/mcp",
        token: "session-token",
        repositories: ["ifBars/S1API"],
        close: () => { readSessionClosed = true; },
      }),
    };
    const trackedAssetReadBroker: AssetRipperReadBrokerPort = {
      openSession: async (root) => {
        assert.equal(root, "C:/references/assetripper");
        return {
          url: "http://127.0.0.1:23456/mcp",
          token: "asset-session-token",
          close: () => { assetReadSessionClosed = true; },
        };
      },
    };
    const github: GitHubPort = {
      getActorPermission: async () => "write",
      addReaction: async () => undefined,
      comment: async (_request, body) => { progressComment = body; return 77; },
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
        assert.equal(options.assetRipperReadSession?.token, "asset-session-token");
        assert.deepEqual(options.readRoots, ["C:/skills"]);
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
      prepare: async () => ({
        skillPath: "C:/skills/schedule-one-modding",
        assetRipperPath: "C:/references/assetripper",
        warnings: [],
      }),
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
      routingAdvisorEnabled: true,
      routingAdvisorModel: "gpt-5.6-luna",
      routingAdvisorTimeoutMs: 30_000,
      sparkCommand: "spark",
      sparkModels: new Set(["gpt-5.3-codex-spark"]),
      sparkReasoningEffort: "medium",
      sparkTimeoutMs: 30 * 60 * 1000,
      sparkAllowUnsandboxedCommands: false,
      jobPollIntervalMs: 1000,
      scheduleOneSkillPath: "C:/skills/schedule-one-modding",
      scheduleOneCodeArchiverUrl: "https://example.test/s1-codearchiver.git",
    };

    await new Worker(
      config,
      store,
      github,
      codex,
      workspaces,
      references,
      trackedReadBroker,
      trackedAssetReadBroker,
    ).process(job);

    assert.equal(finished, "succeeded");
    assert.match(progressComment, /^I'm reviewing this pull request\./);
    assert.equal(inline.length, 1);
    assert.match(updates[0] ?? "", /## Diffuin review/);
    assert.match(updates[0] ?? "", /AI notice/);
    assert.doesNotMatch(updates[0] ?? "", /truncated/);
    assert.equal(readSessionClosed, true);
    assert.equal(assetReadSessionClosed, true);
  });

  it("turns an open-PR issue follow-up into a patch against the requested branch", async () => {
    const implementationJob: Job = {
      ...job,
      kind: "issue",
      mode: "auto",
      closeIssueOnMerge: true,
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
            intent: "implement",
            workflow: "implement-issue",
            kind: "response",
            verdict: "not_applicable",
            findings: [],
            summary: "Implemented the narrow persistence repair and focused regression coverage.",
            pullRequestTitle: "Fix custom NPC relationship persistence",
            closesIssue: false,
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
      routingAdvisorEnabled: true,
      routingAdvisorModel: "gpt-5.6-luna",
      routingAdvisorTimeoutMs: 30_000,
      sparkCommand: "spark",
      sparkModels: new Set(["gpt-5.3-codex-spark"]),
      sparkReasoningEffort: "medium",
      sparkTimeoutMs: 30 * 60 * 1000,
      sparkAllowUnsandboxedCommands: false,
      jobPollIntervalMs: 1000,
      scheduleOneSkillPath: "C:/skills/schedule-one-modding",
      scheduleOneCodeArchiverUrl: "https://example.test/s1-codearchiver.git",
    };

    await new Worker(
      config,
      store,
      github,
      codex,
      workspaces,
      references,
      githubReadBroker,
      assetRipperReadBroker,
    ).process(implementationJob);

    assert.equal(preparedSource, "stable");
    assert.equal(pullRequestBase, "stable");
    assert.equal(pullRequestTitle, "Fix custom NPC relationship persistence");
    assert.match(pullRequestBody, /Closes #12/);
    assert.equal(finished, "succeeded");
    assert.equal(updates.at(-1), "I opened https://example.test/pull/44");
  });

  it("pushes requested changes directly to a Diffuin-owned pull request branch", async () => {
    const implementationJob: Job = {
      ...job,
      mode: "auto",
      task: "remove x from this PR",
    };
    let pushedBranch = "";
    let pullRequestCreated = false;
    let finalComment = "";
    let finished = "";
    const github: GitHubPort = {
      getActorPermission: async () => "write",
      addReaction: async () => undefined,
      comment: async () => 91,
      updateComment: async (_request, _commentId, body) => { finalComment = body; },
      reviewPullRequest: async () => undefined,
      getDefaultBranch: async () => "stable",
      getIssue: async () => ({ title: "unused", body: null }),
      getPullRequest: async () => ({
        title: "Diffuin implementation",
        body: "Closes #11\n\nDiffuin job: `original-job`",
        baseBranch: "stable",
        headBranch: "diffuin/11-abcdef12",
        headSha: "current-head",
        headRepository: "ifBars/S1API",
        additions: 20,
        deletions: 2,
        changedFiles: 2,
        files: ["S1API/Example.cs"],
      }),
      getInstallationToken: async () => "token",
      updateIssue: async () => undefined,
      createPullRequest: async () => {
        pullRequestCreated = true;
        return { number: 99, url: "https://example.test/pull/99" };
      },
    };
    const codex: CodexPort = {
      run: async (_directory, prompt) => {
        assert.match(prompt, /remove x from this PR/);
        return {
          finalResponse: JSON.stringify({
            ...JSON.parse(response),
            intent: "implement",
            workflow: "change-pull-request",
            kind: "response",
            verdict: "not_applicable",
            findings: [],
            summary: "Removed x and updated the focused tests.",
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
        assert.equal(input.sourceRef, "current-head");
        return { path: "C:/temp/work", branch: "diffuin/12-new", remoteUrl: "https://example.test/repo.git" };
      },
      hasChanges: async () => true,
      readPatch: async () => "diff --git a/file b/file",
      commitAndPush: async (_repository: unknown, _token: string, _message: string, targetBranch: string) => {
        pushedBranch = targetBranch;
        return "1234567890abcdef";
      },
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
      routingAdvisorEnabled: true, routingAdvisorModel: "gpt-5.6-luna", routingAdvisorTimeoutMs: 30_000,
      sparkCommand: "spark", sparkModels: new Set(["gpt-5.3-codex-spark"]),
      sparkReasoningEffort: "medium" as const,
      sparkTimeoutMs: 30 * 60 * 1000, sparkAllowUnsandboxedCommands: false,
      scheduleOneSkillPath: "C:/skills/schedule-one-modding",
      scheduleOneCodeArchiverUrl: "https://example.test/archive.git",
    } satisfies Config;

    await new Worker(
      config,
      store,
      github,
      codex,
      workspaces,
      references,
      githubReadBroker,
      assetRipperReadBroker,
    ).process(implementationJob);

    assert.equal(pushedBranch, "diffuin/11-abcdef12");
    assert.equal(pullRequestCreated, false);
    assert.equal(finished, "succeeded");
    assert.match(finalComment, /updated this pull request with commit/);
    assert.match(finalComment, /1234567/);
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
          intent: "investigate",
          workflow: "review-issue",
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
      routingAdvisorEnabled: true, routingAdvisorModel: "gpt-5.6-luna", routingAdvisorTimeoutMs: 30_000,
      sparkCommand: "spark", sparkModels: new Set(["gpt-5.3-codex-spark"]),
      sparkReasoningEffort: "medium" as const,
      sparkTimeoutMs: 30 * 60 * 1000, sparkAllowUnsandboxedCommands: false,
      scheduleOneSkillPath: "C:/skills/schedule-one-modding",
      scheduleOneCodeArchiverUrl: "https://example.test/archive.git",
    } satisfies Config;

    await new Worker(
      config,
      store,
      github,
      codex,
      workspaces,
      references,
      githubReadBroker,
      assetRipperReadBroker,
    ).process(issueJob);

    assert.deepEqual(updatedIssue, {
      title: "[BUG] Custom NPC enters owned properties",
      body: "### Summary\n\nA custom NPC enters an owned property while approaching the player.",
    });
    assert.match(finalComment, /^> I polished the issue description/);
    assert.match(finalComment, /## Issue investigation/);
  });
});
