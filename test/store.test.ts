import assert from "node:assert/strict";
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
    store.finish(claimed!.id, "succeeded");
    assert.equal(store.get(claimed!.id)?.status, "succeeded");
    store.close();
  });
});
