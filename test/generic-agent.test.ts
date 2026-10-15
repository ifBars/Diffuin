import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { artifactOutputSchema, parseArtifact, renderArtifact } from "../src/artifact.js";
import type { Config } from "../src/config.js";
import type { GitWorkspace } from "../src/git.js";
import { parseMention } from "../src/mention.js";
import { GeneralAgentProfile } from "../src/profiles/general.js";
import type { JobStore } from "../src/store.js";
import type { GitHubPort, Job } from "../src/types.js";
import { Worker } from "../src/worker.js";

const task = "Do a new investigative plan on the latest and open a new PR";
const command = parseMention(`@Diffuin ${task}`, "Diffuin")!;
const job: Job = {
  task: command.task, mode: command.mode,
  id: "generic-job", deliveryId: "delivery", installationId: 1, repositoryId: 2,
  repository: "octo/repo", owner: "octo", repo: "repo", issueNumber: 294, commentId: 3,
  actor: "maintainer", kind: "issue", closeIssueOnMerge: false,
  status: "running", createdAt: "now", updatedAt: "now",
};
const envelope = {
  body: "## Investigation and implementation\n\nRefreshed the evidence, updated the plan, and repaired the seat wrapper. Focused checks passed.",
  publishChanges: true, offerImplementation: false, findings: [],
  pullRequestTitle: "Expose portable vehicle seat occupancy", closesIssue: false,
  issuePolish: { needed: false, title: "", body: "", reason: "" },
};

async function execute(options: {
  output?: object; changes?: boolean; mode?: Job["mode"]; permission?: string; task?: string;
} = {}) {
  const optionsOutput = options.output ?? envelope;
  const taskText = options.task ?? task;
  let status = "";
  let error = "";
  let pushed = false;
  let opened = false;
  let response = "";
  let prBody = "";
  let sourceRef = "";
  const github: GitHubPort = {
    getActorPermission: async () => options.permission ?? "write",
    addReaction: async () => undefined, comment: async () => 91,
    updateComment: async (_request, _id, body) => { response = body; },
    reviewPullRequest: async () => [], getDefaultBranch: async () => "main",
    hasBranch: async (_request, branch) => ["stable", "main"].includes(branch),
    getIssue: async () => ({ title: "Vehicle seat API", body: "Expose seat occupancy." }),
    getPullRequest: async () => { throw new Error("unexpected PR lookup"); },
    updateIssue: async () => undefined, getInstallationToken: async () => "token",
    createPullRequest: async (_request, input) => { opened = true; prBody = input.body; return { number: 99, url: "https://example.test/pull/99" }; },
  };
  const workspaces = {
    prepare: async (input: { sourceRef: string }) => {
      sourceRef = input.sourceRef;
      return { path: "C:/temp/work", branch: "diffuin/294-abcdef12", remoteUrl: "https://example.test/repo.git" };
    },
    readRepositoryGuidance: async () => [], currentRevision: async () => "head",
    hasChanges: async () => options.changes ?? true, readPatch: async () => "diff --git a/Seat.cs b/Seat.cs",
    commitAndPush: async () => { pushed = true; return "abc123456789"; }, cleanup: async () => undefined,
  } as unknown as GitWorkspace;
  const store = { finish: (_id: string, result: string, message?: string) => { status = result; error = message ?? ""; } } as unknown as JobStore;
  const config = {
    handle: "Diffuin", allowedRepositories: new Set(["octo/repo"]), autoReasoningRouting: false,
    codexModel: "gpt-6.1-sol", codexReasoningEffort: "high", sparkModels: new Set(),
  } as unknown as Config;
  await new Worker(config, store, github, {
    run: async (_directory, prompt, options) => {
      assert.ok(prompt.includes(taskText));
      assert.match(prompt, /No intent, kind, or workflow labels are required/);
      assert.deepEqual(options.outputSchema, artifactOutputSchema);
      return { finalResponse: JSON.stringify(optionsOutput), threadId: "thread" };
    },
  }, workspaces, new GeneralAgentProfile("C:/skills"), {
    openSession: () => ({ url: "http://localhost/mcp", token: "read", repositories: [], close: () => undefined }),
  }, { openSession: async () => undefined }).process({ ...job, task: taskText, mode: options.mode ?? job.mode });
  return { status, error, pushed, opened, response, prBody, sourceRef };

}

describe("generic agent delivery", () => {
  it("does not fetch prose comparison targets as nonexistent branches", async () => {
    const result = await execute({ changes: false, task: "Compare this against the previous implementation and explain the differences.", output: { ...envelope, publishChanges: false } });
    assert.equal(result.status, "succeeded");
    assert.equal(result.sourceRef, "main");
  });
  it("checks out stable for the immediate retry wording instead of a nonexistent latest branch", async () => {
    const result = await execute({ task: "Investigate this issue against the latest stable branch, update the implementation plan, implement it, and open a new PR." });
    assert.equal(result.status, "succeeded");
    assert.equal(result.sourceRef, "stable");
    const current = await execute({ task: "Open a PR against the current stable branch." });
    assert.equal(current.sourceRef, "stable");
  });
  it("carries the issue #294 compound request through to publication without task labels", async () => {
    assert.equal(job.mode, "auto");
    const result = await execute();
    assert.equal(result.status, "succeeded");
    assert.equal(result.pushed, true);
    assert.equal(result.opened, true);
    assert.match(result.prBody, /Investigation and implementation/);
    assert.match(result.response, /I opened https:\/\/example.test\/pull\/99/);
  });

  it("delivers mixed and formerly inconsistent output labels without throwing", async () => {
    const body = "Here is a plan, explanation, and comparison table.";
    const result = await execute({ changes: false, output: { ...envelope, body, publishChanges: false, intent: "answer", kind: "plan", workflow: "custom" } });
    assert.equal(result.status, "succeeded");
    assert.match(result.response, /comparison table/);
    assert.equal(result.pushed, false);
  });

  it("responds with a blocker instead of failing an implementation with no changes", async () => {
    const result = await execute({ mode: "implement", changes: false, output: { ...envelope, body: "Blocked: the required reference is unavailable. No files changed.", publishChanges: false } });
    assert.equal(result.status, "succeeded");
    assert.match(result.response, /required reference is unavailable/);
    assert.equal(result.opened, false);
  });

  it("refuses patches under explicit read-only commands", async () => {
    const result = await execute({ mode: "review" });
    assert.equal(result.status, "failed");
    assert.match(result.error, /read-only review/);
    assert.equal(result.pushed, false);
    assert.equal(result.opened, false);
  });

  it("does not publish incidental changes or let legacy labels override the delivery flag", async () => {
    const result = await execute({ output: { ...envelope, publishChanges: false, intent: "implement" } });
    assert.equal(result.status, "failed");
    assert.match(result.error, /without requesting publication/);
    assert.equal(result.pushed, false);
  });

  it("rechecks actor authorization before publication", async () => {
    const result = await execute({ permission: "read" });
    assert.equal(result.status, "failed");
    assert.match(result.error, /write-authorized actor/);
    assert.equal(result.pushed, false);
  });

  it("preserves arbitrary Markdown without fixed sections or a summary-size limit", () => {
    const body = `| Option | Tradeoff |\n|---|---|\n| A | Simple |\n\n${"More context. ".repeat(300)}`;
    const artifact = parseArtifact(JSON.stringify({ ...envelope, body, publishChanges: false }));
    const rendered = renderArtifact(artifact, { mode: "auto", model: "model", reasoningEffort: "high", reason: "test" }, { threadId: "thread", elapsedSeconds: 1 });
    assert.ok(rendered.body.startsWith(body));
    assert.equal("intent" in artifactOutputSchema.properties, false);
    assert.equal("kind" in artifactOutputSchema.properties, false);
    assert.equal("workflow" in artifactOutputSchema.properties, false);
    assert.throws(() => parseArtifact("{}"), /body or legacy summary/);
  });
});
