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
  it("maps an issue comment on a pull request", () => {
    const result = parseWorkRequest("issue_comment", "delivery", payload, "Diffuin");
    assert.equal(result?.kind, "pull_request");
    assert.equal(result?.task, "fix the null dereference");
    assert.equal(result?.repository, "octo-org/example-repo");
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
});
