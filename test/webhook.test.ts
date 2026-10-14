import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWorkRequest } from "../src/webhook.js";

const payload = {
  action: "created",
  installation: { id: 42 },
  repository: { id: 7, full_name: "octo-org/example-repo", name: "example-repo", owner: { login: "octo-org" } },
  sender: { login: "octocat", type: "User" },
  issue: { number: 123, pull_request: { url: "https://api.github.test/pulls/123" } },
  comment: { id: 99, body: "@Diffuin fix the null dereference", user: { login: "octocat", type: "User" } },
};

describe("parseWorkRequest", () => {
  it("queues an entire submitted changes-requested review without a mention and deduplicates redelivery", () => {
    const review = {
      ...payload, action: "submitted", pull_request: { number: 123 },
      review: { id: 800, state: "changes_requested", user: { login: "octocat", type: "User" } },
    };
    const result = parseWorkRequest("pull_request_review", "first", review, "Diffuin");
    assert.equal(result?.mode, "implement");
    assert.equal(result?.commentKind, "review");
    assert.equal(result?.commentId, 800);
    assert.equal(result?.deliveryId, "review:7:800");
    assert.equal(parseWorkRequest("pull_request_review", "retry", review, "Diffuin")?.deliveryId, result?.deliveryId);
    for (const state of ["approved", "commented", "pending", "dismissed"]) {
      assert.equal(parseWorkRequest("pull_request_review", "x", {
        ...review, review: { ...review.review, state },
      }, "Diffuin"), null);
    }
    assert.equal(parseWorkRequest("pull_request_review", "x", { ...review, action: "edited" }, "Diffuin"), null);
    assert.equal(parseWorkRequest("pull_request_review", "x", {
      ...review, review: { ...review.review, user: { login: "other[bot]", type: "Bot" } },
    }, "Diffuin"), null);
    assert.equal(parseWorkRequest("pull_request_review_comment", "x", {
      ...payload, pull_request: { number: 123 }, comment: { ...payload.comment, body: "This leaks a native type" },
    }, "Diffuin"), null);
  });

  it("maps an issue comment on a pull request", () => {
    const result = parseWorkRequest("issue_comment", "delivery", payload, "Diffuin");
    assert.equal(result?.kind, "pull_request");
    assert.equal(result?.task, "fix the null dereference");
    assert.equal(result?.mode, "implement");
    assert.equal(result?.repository, "octo-org/example-repo");
  });

  it("routes a compound issue investigation to its requested plan deliverable", () => {
    const result = parseWorkRequest("issue_comment", "delivery", {
      ...payload,
      issue: { number: 260 },
      comment: {
        ...payload.comment,
        body: "@Diffuin Investigate this issue deeply and create a plan to fix it",
      },
    }, "Diffuin");

    assert.equal(result?.kind, "issue");
    assert.equal(result?.mode, "plan");
    assert.equal(result?.task, "Investigate this issue deeply and create a plan to fix it");
  });

  it("ignores bot comments and non-created actions", () => {
    assert.equal(parseWorkRequest("issue_comment", "delivery", { ...payload, action: "edited" }, "Diffuin"), null);
    assert.equal(
      parseWorkRequest(
        "issue_comment",
        "delivery",
        { ...payload, comment: { ...payload.comment, user: { login: "Diffuin", type: "Bot" } } },
        "Diffuin",
      ),
      null,
    );
  });

  it("turns a checked Diffuin plan action into one issue-closing implementation request", () => {
    const action = "<!-- diffuin:implement-plan -->\n- [ ] Create a pull request to implement this plan and close this issue when merged.";
    const checked = action.replace("[ ]", "[x]");
    const result = parseWorkRequest("issue_comment", "edited-delivery", {
      ...payload,
      action: "edited",
      issue: { number: 123 },
      sender: { login: "maintainer", type: "User" },
      comment: { id: 101, body: `## Implementation plan\n\n${checked}`, user: { login: "Diffuin[bot]", type: "Bot" } },
      changes: { body: { from: `## Implementation plan\n\n${action}` } },
    }, "Diffuin");

    assert.equal(result?.deliveryId, "plan-action:7:101");
    assert.equal(result?.actor, "maintainer");
    assert.equal(result?.kind, "issue");
    assert.equal(result?.mode, "implement");
    assert.equal(result?.closeIssueOnMerge, true);
    assert.match(result?.task ?? "", /approved plan in Diffuin comment #101/);
  });

  it("ignores plan actions without the exact Diffuin-authored unchecked-to-checked transition", () => {
    const checked = "<!-- diffuin:implement-plan -->\n- [x] Create a pull request to implement this plan and close this issue when merged.";
    const edited = {
      ...payload,
      action: "edited",
      issue: { number: 123 },
      sender: { login: "maintainer", type: "User" },
      comment: { id: 101, body: checked, user: { login: "octocat", type: "User" } },
      changes: { body: { from: checked.replace("[x]", "[ ]") } },
    };
    assert.equal(parseWorkRequest("issue_comment", "delivery", edited, "Diffuin"), null);
    assert.equal(parseWorkRequest("issue_comment", "delivery", {
      ...edited,
      issue: payload.issue,
      comment: { ...edited.comment, user: { login: "Diffuin[bot]", type: "Bot" } },
    }, "Diffuin"), null);
  });
});
