import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { evaluationSplit, exportLearningEvaluation } from "../src/evaluation.js";
import { JobStore } from "../src/store.js";
import type { DiffuinArtifact } from "../src/artifact.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("evaluationSplit", () => {
  it("assigns jobs deterministically to closed dataset partitions", () => {
    const first = evaluationSplit("job-123");
    assert.equal(evaluationSplit("job-123"), first);
    assert.ok(["train", "validation", "holdout"].includes(first));
  });

  it("exports attributable runs into JSONL without mutating the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "diffuin-evaluation-"));
    directories.push(directory);
    const databasePath = join(directory, "diffuin.sqlite");
    const outputPath = join(directory, "artifacts", "evaluation.jsonl");
    const store = new JobStore(databasePath);
    const job = store.enqueue({
      deliveryId: "delivery", installationId: 1, repositoryId: 2,
      repository: "octo/example", owner: "octo", repo: "example",
      issueNumber: 3, commentId: 4, actor: "maintainer", kind: "issue",
      task: "answer it", mode: "answer", closeIssueOnMerge: false,
    })!;
    const artifact: DiffuinArtifact = {
      intent: "answer", workflow: "none", kind: "response", verdict: "not_applicable",
      confidence: "high", summary: "Answered.", findings: [], evidence: [], designChoices: [], phases: [],
      validationPerformed: [], validationRemaining: [], openQuestions: [], pullRequestTitle: "", closesIssue: false,
      issuePolish: { needed: false, title: "", body: "", reason: "" },
    };
    store.saveArtifact(job, artifact, "abc123", 5, { provider: "codex", model: "test-model" });
    store.close();

    assert.equal(exportLearningEvaluation(databasePath, outputPath), 1);
    const record = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(record.job_id, job.id);
    assert.equal(record.artifact.summary, "Answered.");
    assert.ok(["train", "validation", "holdout"].includes(record.split));
  });
});
