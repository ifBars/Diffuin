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
    assert.equal(result?.mode, "auto");
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
