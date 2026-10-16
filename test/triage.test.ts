import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { loadTriagePolicies, parseTriageRequest, runIssueTriage, triagePatch } from "../src/triage.js";
import { createDiffuinServer } from "../src/server.js";
import { Worker } from "../src/worker.js";
import { exportLearningEvaluation } from "../src/evaluation.js";
import { JobStore } from "../src/store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/config.js";
import type { GitHubPort, IssueContext, WorkRequest } from "../src/types.js";

const allowed = new Set(["example/project"]);
const policies = loadTriagePolicies(JSON.stringify({ "example/project": {
  rules: "Private rubric: weigh scope and impact. An optional-adapter crash is moderate; a pervasive core crash is urgent.",
  bugLabel: "bug", featureLabel: "enhancement",
  severityLabels: { low: "Low", medium: "Medium", high: "High", critical: "Critical" },
  topicLabels: ["storage"],
} }), allowed);
const policy = policies.get("example/project")!;
const config = { allowedRepositories: allowed, issueTriagePolicies: policies,
  allowedCodexModels: new Set(["gpt-6-luna"]), sparkModels: new Set(), githubWebhookSecret: "secret" } as unknown as Config;
const payload = {
  action: "opened", installation: { id: 1 }, repository: { id: 2, full_name: "example/project" },
  sender: { login: "outside-reporter", type: "User" }, issue: { number: 3, state: "open" },
};
const request = parseTriageRequest("issues", "delivery", payload, config)!;
const decision = { kind: "bug", severity: "medium", confidence: "high", topics: ["storage"], reason: "An optional adapter is required." } as const;
const output = { ...decision, topics: [...decision.topics] };
const labels = ["bug", "enhancement", "Low", "Medium", "High", "Critical", "storage"];
const issue: IssueContext = { title: "Adapter load crash", body: "Crashes only with the optional adapter.", labels: [], state: "open" };

describe("private issue triage", () => {
  it("opts in only configured repositories and accepts outside reporters for metadata jobs", () => {
    assert.equal(request.commentKind, "triage");
    assert.equal(request.actor, "outside-reporter");
    for (const changed of [
      { action: "closed" }, { sender: { login: "bot", type: "Bot" } },
      { issue: { number: 3, state: "open", pull_request: {} } },
      { repository: { id: 2, full_name: "other/project" } },
      { installation: { id: -1 } }, { action: "edited" },
    ]) assert.equal(parseTriageRequest("issues", "d", { ...payload, ...changed }, config), null);
    assert.equal(parseTriageRequest("issue_comment", "d", payload, config), null);
    assert.equal(parseTriageRequest("issues", "d", payload, { ...config, issueTriagePolicies: new Map() }), null);
  });

  it("rejects invalid configuration without echoing private values", () => {
    assert.throws(() => loadTriagePolicies('{"private-payload":"secret"}', allowed), (error: Error) => {
      assert.doesNotMatch(error.message, /secret|private-payload/); return true;
    });
    assert.throws(() => loadTriagePolicies(JSON.stringify({ "other/project": policy }), allowed));
    assert.throws(() => loadTriagePolicies(JSON.stringify({ "example/project": { ...policy, featureLabel: "BUG" } }), allowed));
  });

  it("normalizes prefixes and adds only missing labels", () => {
    const patch = triagePatch(issue, output, policy, labels)!;
    assert.deepEqual(patch, { title: "[BUG] Adapter load crash", addLabels: ["bug", "storage", "Medium"] });
    assert.deepEqual(triagePatch({ ...issue, title: "[bug] [BUG] Adapter load crash", labels: patch.addLabels }, output, policy, labels),
      { title: patch.title, addLabels: [] });
  });

  it("preserves severity overrides and unrelated labels", () => {
    const patch = triagePatch({ ...issue, labels: ["High", "help wanted"] }, output, policy, labels)!;
    assert.deepEqual(patch.addLabels, ["bug", "storage"]);
    assert.equal(triagePatch({ ...issue, title: "[FEATURE] Adapter" }, output, policy, labels), null);
    assert.equal(triagePatch({ ...issue, labels: ["enhancement"] }, output, policy, labels), null);
  });

  it("does not invent labels or assign severity to features", () => {
    assert.throws(() => triagePatch(issue, { ...output, topics: ["made-up"] }, policy, labels));
    assert.throws(() => triagePatch(issue, output, policy, []));
    assert.throws(() => triagePatch(issue, { ...output, kind: "feature" }, policy, labels));
    assert.equal(triagePatch(issue, { ...output, confidence: "medium" }, policy, labels), null);
    assert.equal(triagePatch(issue, { ...output, kind: "other" }, policy, labels), null);
    assert.deepEqual(triagePatch({ ...issue, title: "Add export" }, { ...output, kind: "feature", severity: "none", topics: [] }, policy, labels),
      { title: "[FEATURE] Add export", addLabels: ["enhancement"] });
  });

  it("keeps classification isolated and skips stale reports", async () => {
    let reads = 0;
    let writes = 0;
    const github = {
      getIssue: async () => ++reads === 1 ? issue : { ...issue, body: "Maintainer updated the report" },
      listIssueLabels: async () => labels.map((name) => ({ name, description: null })),
      applyIssueTriage: async () => { writes++; },
    } as unknown as GitHubPort;
    const result = await runIssueTriage(config, github, request, async (prompt) => {
      assert.match(prompt, /PRIVATE DEPLOYMENT POLICY/);
      assert.match(prompt, /UNTRUSTED REPORT DATA/);
      return JSON.stringify(output);
    });
    assert.equal(result.status, "stale");
    assert.equal(writes, 0);
  });

  it("applies a validated patch without any comment, checkout, or publication", async () => {
    const writes: unknown[] = [];
    const github = {
      getIssue: async () => issue,
      listIssueLabels: async () => labels.map((name) => ({ name, description: null })),
      applyIssueTriage: async (_request: WorkRequest, patch: unknown) => { writes.push(patch); },
    } as unknown as GitHubPort;
    assert.equal((await runIssueTriage(config, github, request, async () => JSON.stringify(output))).status, "applied");
    assert.equal(writes.length, 1);
    await assert.rejects(runIssueTriage(config, github, request, async () => JSON.stringify({ ...output, publish: true })));
  });

  it("verifies webhook signatures and deduplicates metadata jobs durably", async () => {
    const directory = mkdtempSync(join(tmpdir(), "diffuin-triage-"));
    const store = new JobStore(join(directory, "jobs.sqlite"));
    const server = createDiffuinServer(config, store, {} as GitHubPort);
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const body = JSON.stringify(payload);
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks/github`;
      const headers = { "x-github-event": "issues", "x-github-delivery": "delivery",
        "x-hub-signature-256": `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}` };
      assert.equal((await fetch(url, { method: "POST", body })).status, 401);
      assert.equal((await (await fetch(url, { method: "POST", body, headers })).json() as any).status, "queued");
      assert.equal((await (await fetch(url, { method: "POST", body, headers })).json() as any).status, "duplicate");
      const job = store.claimNext()!;
      assert.equal(job.commentKind, "triage");
      store.saveTriageArtifact(job, { status: "applied", decision: output });
      assert.equal(exportLearningEvaluation(join(directory, "jobs.sqlite"), join(directory, "learning.jsonl")), 0);
      store.finish(job.id, "succeeded");
      assert.equal(store.get(job.id)?.status, "succeeded");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("routes failures privately without reaching the normal worker or public delivery", async () => {
    const directory = mkdtempSync(join(tmpdir(), "diffuin-triage-worker-"));
    const store = new JobStore(join(directory, "jobs.sqlite"));
    try {
      const job = store.enqueue(request)!;
      const github = { getIssue: async () => { throw new Error("Private policy must not be echoed"); },
        listIssueLabels: async () => [], applyIssueTriage: async () => undefined } as unknown as GitHubPort;
      const worker = new Worker(config, store, github, undefined!, undefined!, undefined!, undefined!, undefined!);
      await worker.process(job);
      assert.equal(store.get(job.id)?.status, "failed");
      assert.doesNotMatch(store.get(job.id)?.error ?? "", /must not be echoed/);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
