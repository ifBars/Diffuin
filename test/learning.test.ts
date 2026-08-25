import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFeedbackEvent, parseMemoryCommand, parsePullRequestOutcome } from "../src/learning.js";

const payload = {
  action: "created",
  installation: { id: 42 },
  repository: { id: 7, full_name: "octo-org/example-repo" },
  sender: { login: "maintainer", type: "User" },
  issue: { number: 12, pull_request: { url: "https://api.github.test/pulls/12" } },
  comment: { id: 99, body: "", user: { login: "maintainer", type: "User" } },
};

describe("learning webhook parsing", () => {
  it("parses explicit repository, path, and user memories", () => {
    const repository = parseMemoryCommand("issue_comment", "delivery-1", {
      ...payload,
      comment: {
        ...payload.comment,
        body: "@Diffuin remember warning for this repository: Generated clients must be regenerated because handwritten edits drift",
      },
    }, "Diffuin");
    assert.equal(repository?.memoryAction, "remember");
    assert.equal(repository?.memoryScope, "repository");
    assert.equal(repository?.memoryKind, "warning");
    assert.equal(repository?.memoryText, "Generated clients must be regenerated");
    assert.equal(repository?.memoryRationale, "handwritten edits drift");

    const path = parseMemoryCommand("pull_request_review_comment", "delivery-2", {
      ...payload,
      comment: { ...payload.comment, body: "@Diffuin remember for src/api/**: run the contract suite" },
    }, "Diffuin");
    assert.equal(path?.memoryScope, "path");
    assert.equal(path?.memoryPathGlob, "src/api/**");

    const user = parseMemoryCommand("issue_comment", "delivery-3", {
      ...payload,
      comment: { ...payload.comment, body: "@Diffuin remember for me: keep summaries terse" },
    }, "Diffuin");
    assert.equal(user?.memoryScope, "user");
  });

  it("parses list and forget controls without turning ordinary work into memory", () => {
    const list = parseMemoryCommand("issue_comment", "delivery", {
      ...payload,
      comment: { ...payload.comment, body: "@Diffuin what have you learned?" },
    }, "Diffuin");
    assert.equal(list?.memoryAction, "list");

    const id = "d9428888-122b-11e1-b85c-61cd3cbb3210";
    const forget = parseMemoryCommand("issue_comment", "delivery", {
      ...payload,
      comment: { ...payload.comment, body: `@Diffuin forget ${id}` },
    }, "Diffuin");
    assert.equal(forget?.memoryId, id);
    assert.equal(parseMemoryCommand("issue_comment", "delivery", {
      ...payload,
      comment: { ...payload.comment, body: "@Diffuin fix the failing test" },
    }, "Diffuin"), null);
  });

  it("accepts explicit review-thread feedback and correlatable Diffuin PR outcomes", () => {
    const feedback = parseFeedbackEvent("pull_request_review_comment", "feedback-delivery", {
      ...payload,
      pull_request: { number: 12 },
      comment: {
        ...payload.comment,
        in_reply_to_id: 501,
        body: "@Diffuin this is a false positive because the provider requires synchronous delivery",
      },
    });
    assert.equal(feedback?.signal, "negative");
    assert.equal(feedback?.operation, "add");
    assert.equal(feedback?.externalCommentId, 501);

    const jobId = "d9428888-122b-11e1-b85c-61cd3cbb3210";
    const outcome = parsePullRequestOutcome("pull_request", "closed-delivery", {
      ...payload,
      action: "closed",
      pull_request: {
        number: 44,
        merged: true,
        merge_commit_sha: "abc123",
        body: `Implemented the change.\n\nDiffuin job: \`${jobId}\``,
      },
    });
    assert.equal(outcome?.outcome, "merged");
    assert.equal(outcome?.jobId, jobId);
  });
});
