import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { JobStore } from "../src/store.js";
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
    store.close();
  });
});
