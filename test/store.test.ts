import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { JobStore } from "../src/store.js";
import type { DiffuinArtifact } from "../src/artifact.js";
import type { WorkRequest } from "../src/types.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const request: WorkRequest = {
  deliveryId: "delivery-1",
  installationId: 42,
  repositoryId: 7,
  repository: "octo-org/example-repo",
  owner: "octo-org",
  repo: "example-repo",
  issueNumber: 123,
  commentId: 99,
  actor: "octocat",
  kind: "issue",
  task: "fix it",
  mode: "implement",
  closeIssueOnMerge: true,
  requestedModel: "gpt-5.6-terra",
  requestedReasoningEffort: "high",
};

describe("JobStore", () => {
  it("deduplicates deliveries and persists transitions", () => {
    const directory = mkdtempSync(join(tmpdir(), "diffuin-test-"));
    directories.push(directory);
    const store = new JobStore(join(directory, "jobs.sqlite"));
    const queued = store.enqueue(request);
    assert.ok(queued);
    assert.equal(store.enqueue(request), null);
    const claimed = store.claimNext();
    assert.equal(claimed?.status, "running");
    assert.equal(claimed?.mode, "implement");
    assert.equal(claimed?.requestedModel, "gpt-5.6-terra");
    assert.equal(claimed?.requestedReasoningEffort, "high");
    assert.equal(claimed?.closeIssueOnMerge, true);
    store.finish(claimed!.id, "succeeded");
    assert.equal(store.get(claimed!.id)?.status, "succeeded");
    store.close();
  });

  it("migrates an existing job database without losing rows", () => {
    const directory = mkdtempSync(join(tmpdir(), "diffuin-test-"));
    directories.push(directory);
    const path = join(directory, "jobs.sqlite");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL UNIQUE, installation_id INTEGER NOT NULL,
        repository_id INTEGER NOT NULL, repository TEXT NOT NULL, owner TEXT NOT NULL, repo TEXT NOT NULL,
        issue_number INTEGER NOT NULL, comment_id INTEGER NOT NULL, actor TEXT NOT NULL,
        kind TEXT NOT NULL, task TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT
      );
      INSERT INTO jobs VALUES (
        'legacy', 'delivery', 1, 2, 'ifBars/S1API', 'ifBars', 'S1API', 1, 3,
        'ifBars', 'issue', 'plan it', 'queued', 'now', 'now', NULL
      );
    `);
    legacy.close();

    const store = new JobStore(path);
    assert.equal(store.get("legacy")?.mode, "auto");
    assert.equal(store.get("legacy")?.closeIssueOnMerge, false);
    store.close();
  });

  it("stores scoped memories, retrieves relevant paths, and retires them", () => {
    const directory = mkdtempSync(join(tmpdir(), "diffuin-test-"));
    directories.push(directory);
    const store = new JobStore(join(directory, "jobs.sqlite"));
    const command = {
      ...request,
      evidenceUrl: "https://github.com/octo-org/example-repo/issues/123#issuecomment-99",
      memoryAction: "remember" as const,
      memoryScope: "path" as const,
      memoryKind: "preference" as const,
      memoryText: "Run the API contract suite",
      memoryPathGlob: "src/api/**",
    };
    const memory = store.remember(command);
    assert.equal(store.remember(command).id, memory.id, "webhook retries must be idempotent");
    const queued = store.enqueue({ ...request, deliveryId: "memory-job" })!;
    assert.equal(store.listApplicableMemories(queued, ["src/api/client.ts"], false).length, 1);
    assert.equal(store.listApplicableMemories(queued, ["docs/readme.md"], false).length, 0);
    assert.equal(store.forgetMemory({ ...command, memoryAction: "forget", memoryId: memory.id }), true);
    assert.equal(store.listMemories(request).length, 0);
    store.close();
  });

  it("correlates delivered findings with authorized feedback and PR outcomes", () => {
    const directory = mkdtempSync(join(tmpdir(), "diffuin-test-"));
    directories.push(directory);
    const store = new JobStore(join(directory, "jobs.sqlite"));
    const queued = store.enqueue({ ...request, deliveryId: "artifact-job" })!;
    const artifact: DiffuinArtifact = {
      intent: "review", workflow: "review-pull-request", kind: "review", verdict: "changes_requested",
      confidence: "high", summary: "One issue.", evidence: [], designChoices: [], phases: [],
      validationPerformed: [], validationRemaining: [], openQuestions: [], pullRequestTitle: "", closesIssue: false,
      issuePolish: { needed: false, title: "", body: "", reason: "" },
      findings: [{
        severity: "P1", title: "Unsafe mutation", path: "src/api.ts", line: 10,
        body: "Mutation bypasses the guard.", recommendation: "Use the guarded path.",
      }],
    };
    store.saveArtifact(queued, artifact, "abc123", 77);
    store.recordDeliveredFindings(queued.id, artifact, [501]);
    assert.equal(store.recordFeedback({
      ...request,
      deliveryId: "reaction-1",
      externalCommentId: 501,
      signal: "positive",
      operation: "add",
    }), true);
    assert.equal(store.recordFeedback({
      ...request,
      deliveryId: "reaction-2",
      externalCommentId: 999,
      signal: "negative",
      operation: "add",
    }), false);
    store.replaceFindingReactions(501, [
      { actor: "maintainer", signal: "positive" },
      { actor: "reviewer", signal: "negative" },
    ]);
    assert.deepEqual(store.findingsForFeedbackSync(queued.repositoryId), []);
    assert.equal(store.recordPullRequestOutcome({
      deliveryId: "closed-1",
      jobId: queued.id,
      repositoryId: queued.repositoryId,
      pullRequestNumber: 44,
      outcome: "merged",
      commitSha: "def456",
    }), true);
    store.close();
  });
});
