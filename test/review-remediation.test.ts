import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { Config } from "../src/config.js";
import type { GitWorkspace } from "../src/git.js";
import { GitHubClient } from "../src/github.js";
import { GeneralAgentProfile } from "../src/profiles/general.js";
import { createDiffuinServer } from "../src/server.js";
import type { JobStore } from "../src/store.js";
import type { CodexPort, GitHubPort, Job, PullRequestContext, PullRequestReviewContext, WorkRequest } from "../src/types.js";
import { Worker } from "../src/worker.js";

const job: Job = {
  id: "job", deliveryId: "review:7:800", installationId: 42, repositoryId: 7,
  repository: "octo/repo", owner: "octo", repo: "repo", issueNumber: 123,
  commentId: 800, commentKind: "review", actor: "maintainer", kind: "pull_request",
  task: "Address requested review changes", mode: "implement", closeIssueOnMerge: false,
  status: "running", createdAt: "now", updatedAt: "now",
};
const pull: PullRequestContext = {
  title: "Add wrapper", body: "Diffuin job: `original-job`", author: "diffuin[bot]", state: "open",
  baseBranch: "main", headBranch: "diffuin/11-abcdef12", headSha: "original-head",
  headRepository: "octo/repo", additions: 20, deletions: 0, changedFiles: 1, files: ["Wrapper.cs"],
};
const review: PullRequestReviewContext = {
  id: 800, actor: "maintainer", state: "CHANGES_REQUESTED", body: "Preserve cross-runtime compatibility",
  comments: [{ id: 900, body: "This leaks a native type", path: "Wrapper.cs", line: 61, diffHunk: "+ public Native.State State =>" }],
};
const config = {
  handle: "Diffuin", githubWebhookSecret: "test-webhook-secret", allowedRepositories: new Set(["octo/repo"]),
  codexModel: "gpt-6.1-sol", codexReasoningEffort: "high", autoReasoningRouting: false,
  allowedCodexModels: new Set(["gpt-6.1-sol"]), sparkModels: new Set(),
} as unknown as Config;

function fixture(options: { changes?: boolean; stale?: boolean; permission?: string; permissionAfterRun?: string; dismissedAfterRun?: boolean; replyFailure?: boolean; pull?: Partial<PullRequestContext>; review?: Partial<PullRequestReviewContext> } = {}) {
  let finished = "";
  let failure = "";
  let pushedBranch = "";
  let ran = false;
  let reads = 0;
  const updates: string[] = [];
  const replies: Array<{ id: number; body: string }> = [];
  const github: GitHubPort = {
    getActorPermission: async () => (ran ? options.permissionAfterRun : undefined) ?? options.permission ?? "write",
    addReaction: async () => undefined,
    comment: async () => 91,
    updateComment: async (_request, _id, body) => { updates.push(body); },
    reviewPullRequest: async () => [],
    getDefaultBranch: async () => "main",
    getIssue: async () => { throw new Error("unexpected issue"); },
    getPullRequest: async () => ({ ...pull, ...options.pull, ...(options.stale && reads++ > 0 ? { headSha: "new-head" } : {}) }),
    getPullRequestReview: async () => ({ ...review, ...options.review, ...(ran && options.dismissedAfterRun ? { state: "DISMISSED" } : {}) }),
    replyToReviewComment: async (_request, id, body) => {
      if (options.replyFailure) throw new Error("Reply API unavailable");
      replies.push({ id, body });
    },
    updateIssue: async () => undefined,
    getInstallationToken: async () => "token",
    createPullRequest: async () => { throw new Error("must update existing PR"); },
  };
  const codex: CodexPort = {
    run: async (_directory, prompt) => {
      ran = true;
      assert.match(prompt, /This leaks a native type/);
      assert.match(prompt, /Wrapper.cs:61/);
      assert.match(prompt, /Preserve cross-runtime compatibility/);
      assert.match(prompt, /false positives and stale findings/);
      return {
        threadId: "thread", finalResponse: JSON.stringify({
          intent: "implement", workflow: "change-pull-request", kind: "response", verdict: "not_applicable",
          confidence: "high", summary: options.changes === false
            ? "Comment #900: the current state already uses the portable enum. No change is required."
            : "Comment #900: replaced the native state with a portable enum.",
          findings: [], evidence: [], designChoices: [], phases: [], openQuestions: [],
          validationPerformed: ["Focused contract checks passed."], validationRemaining: ["Live runtime check."],
        }),
      };
    },
  };
  const store = { finish: (_id: string, status: string, error?: string) => { finished = status; failure = error ?? ""; } } as unknown as JobStore;
  const workspaces = {
    prepare: async () => ({ path: "C:/temp/work", branch: "diffuin/123-new", remoteUrl: "https://example.test/repo.git", comparisonReference: "refs/diffuin/base" }),
    readRepositoryGuidance: async () => [], currentRevision: async () => "original-head",
    hasChanges: async () => options.changes ?? true, readPatch: async () => "diff --git a/Wrapper.cs b/Wrapper.cs",
    commitAndPush: async (_repository: unknown, _token: string, _message: string, branch: string) => { pushedBranch = branch; return "1234567890abcdef"; },
    cleanup: async () => undefined,
  } as unknown as GitWorkspace;
  const worker = new Worker(config, store, github, codex, workspaces, new GeneralAgentProfile("C:/skills"), {
    openSession: () => ({ url: "http://localhost/mcp", token: "read", repositories: [], close: () => undefined }),
  }, { openSession: async () => undefined });
  return { worker, github, store, updates, replies, result: () => ({ finished, failure, pushedBranch, ran }) };
}

describe("automatic review remediation", () => {
  it("pushes the repair to the PR and replies with the commit, disposition, and validation", async () => {
    const f = fixture();
    await f.worker.process(job);
    assert.equal(f.result().finished, "succeeded");
    assert.equal(f.result().pushedBranch, pull.headBranch);
    assert.equal(f.replies[0]?.id, 900);
    assert.match(f.replies[0]?.body ?? "", /1234567/);
    assert.match(f.replies[0]?.body ?? "", /Comment #900/);
    assert.match(f.updates.at(-1) ?? "", /Focused contract checks passed/);
  });

  it("explains already addressed findings without manufacturing changes", async () => {
    const f = fixture({ changes: false });
    await f.worker.process(job);
    assert.equal(f.result().finished, "succeeded");
    assert.equal(f.result().pushedBranch, "");
    assert.equal(f.replies.length, 1);
    assert.match(f.replies[0]?.body ?? "", /I made no repository changes/);
  });

  it("refuses stale patches", async () => {
    const f = fixture({ stale: true });
    await f.worker.process(job);
    assert.equal(f.result().finished, "failed");
    assert.match(f.result().failure, /head changed/);
    assert.equal(f.result().pushedBranch, "");
    assert.equal(f.replies.length, 0);
  });

  it("rechecks permissions, ownership, open state, and review state before running", async () => {
    for (const options of [
      { permission: "read" }, { pull: { author: "maintainer" } }, { pull: { state: "closed" } },
      { pull: { headRepository: "outsider/repo" } }, { pull: { headBranch: "feature/test" } },
      { review: { state: "DISMISSED" } }, { review: { actor: "outsider" } },
    ]) {
      const f = fixture(options);
      await f.worker.process(job);
      assert.equal(f.result().finished, "failed");
      assert.equal(f.result().ran, false);
      assert.equal(f.result().pushedBranch, "");
    }
  });

  it("refuses publication after permissions are revoked or the review is dismissed", async () => {
    for (const options of [{ permissionAfterRun: "read" }, { dismissedAfterRun: true }]) {
      const f = fixture(options);
      await f.worker.process(job);
      assert.equal(f.result().ran, true);
      assert.equal(f.result().finished, "failed");
      assert.equal(f.result().pushedBranch, "");
    }
  });

  it("retains the published commit link if a thread reply fails", async () => {
    const f = fixture({ replyFailure: true });
    await f.worker.process(job);
    assert.equal(f.result().finished, "failed");
    assert.equal(f.result().pushedBranch, pull.headBranch);
    assert.match(f.updates.at(-1) ?? "", /I pushed commit.*1234567/);
    assert.match(f.updates.at(-1) ?? "", /Reply API unavailable/);
  });

  it("authorizes signed submissions and rejects unauthorized or non-Diffuin reviews at ingress", async () => {
    for (const [options, expected] of [
      [{}, "queued"], [{ permission: "read" }, "actor_not_authorized"],
      [{ pull: { author: "maintainer" } }, "review_not_actionable"],
    ] as const) {
      const f = fixture(options);
      let queued: WorkRequest | undefined;
      const store = { enqueue: (request: WorkRequest) => { queued = request; return { ...request, id: "job" }; } } as JobStore;
      const server = createDiffuinServer(config, store, f.github);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const body = JSON.stringify({ action: "submitted", installation: { id: 42 },
          repository: { id: 7, full_name: "octo/repo" }, pull_request: { number: 123 },
          review: { id: 800, state: "changes_requested", user: { login: "maintainer", type: "User" } },
        });
        const address = server.address() as AddressInfo;
        const response = await fetch(`http://127.0.0.1:${address.port}/webhooks/github`, {
          method: "POST", body, headers: {
            "x-github-event": "pull_request_review", "x-github-delivery": "delivery",
            "x-hub-signature-256": `sha256=${createHmac("sha256", config.githubWebhookSecret).update(body).digest("hex")}`,
          },
        });
        assert.equal(response.status, 202);
        assert.equal((await response.json() as { status: string }).status, expected);
        assert.equal(queued?.commentKind, expected === "queued" ? "review" : undefined);
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    }
  });
});

describe("review connector delivery", () => {
  it("uses review-comment reactions, skips review reactions, and replies through the pull API", async () => {
    const client = Object.create(GitHubClient.prototype) as GitHubClient;
    const calls: string[] = [];
    Object.assign(client, { installation: async () => ({ rest: {
      reactions: {
        createForIssueComment: async () => { calls.push("issue"); },
        createForPullRequestReviewComment: async () => { calls.push("inline"); },
      },
      pulls: { createReplyForReviewComment: async (input: { comment_id: number; pull_number: number }) => {
        assert.equal(input.comment_id, 900); assert.equal(input.pull_number, 123); calls.push("reply");
      } },
    } }) });
    await client.addReaction(job, "eyes");
    await client.addReaction({ ...job, commentKind: "review_comment" }, "eyes");
    await client.addReaction({ ...job, commentKind: "issue" }, "eyes");
    await client.replyToReviewComment(job, 900, "Fixed.");
    assert.deepEqual(calls, ["inline", "issue", "reply"]);
  });
});
