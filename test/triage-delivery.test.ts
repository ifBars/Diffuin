import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GitHubClient } from "../src/github.js";

const request = { owner: "example", repo: "project", repository: "example/project", issueNumber: 1, installationId: 2 } as any;
const marker = "<!-- diffuin:template-reminder:bug -->";

describe("triage GitHub delivery", () => {
  it("deduplicates reminders against the app's own comments across the complete conversation", async () => {
    const comments: any[] = [
      { user: { type: "User", login: "reporter" }, body: marker },
      { user: { type: "Bot", login: "other[bot]" }, body: marker },
    ];
    let posted = 0;
    const client = new GitHubClient(1, "unused", "secret");
    const octokit = {
      rest: { issues: { listComments: () => undefined, get: async () => ({ data: { state: "open", body: "original" } }) } },
      paginate: async () => comments,
    };
    Object.assign(client, { app: { getInstallationOctokit: async () => octokit, octokit: { request: async () => ({ data: { slug: "penguin" } }) } } });
    client.comment = async (_request, body) => {
      posted++;
      comments.push({ user: { type: "Bot", login: "penguin[bot]" }, body });
      return 1;
    };
    assert.equal(await client.remindIssueTemplate(request, "bug", ".github/ISSUE_TEMPLATE/bug.yml", "original"), true);
    assert.equal(await client.remindIssueTemplate(request, "bug", ".github/ISSUE_TEMPLATE/bug.yml", "original"), false);
    assert.equal(posted, 1);
  });

  it("does not remind after the report changed or closed", async () => {
    const client = new GitHubClient(1, "unused", "secret");
    const issue = { state: "open", body: "edited" };
    const octokit = { rest: { issues: { listComments: () => undefined, get: async () => ({ data: issue }) } }, paginate: async () => [] };
    Object.assign(client, { app: { getInstallationOctokit: async () => octokit, octokit: { request: async () => ({ data: { slug: "penguin" } }) } } });
    client.comment = async () => { throw new Error("Must not post"); };
    assert.equal(await client.remindIssueTemplate(request, "bug", ".github/ISSUE_TEMPLATE/bug.yml", "original"), false);
    issue.state = "closed";
    assert.equal(await client.remindIssueTemplate(request, "bug", ".github/ISSUE_TEMPLATE/bug.yml", "edited"), false);
  });

  it("uses additive assignment and reports a silently rejected assignee", async () => {
    const client = new GitHubClient(1, "unused", "secret");
    const current = { title: "[BUG] Problem", body: "original", state: "open", labels: ["bug"], assignees: [{ login: "existing" }] };
    let accepted = true;
    const octokit = { rest: { issues: {
      get: async () => ({ data: current }),
      addAssignees: async (input: { assignees: string[] }) => {
        assert.deepEqual(input.assignees, ["maintainer"]);
        return { data: { assignees: accepted ? [...current.assignees, { login: "maintainer" }] : current.assignees } };
      },
    } } };
    Object.assign(client, { app: { getInstallationOctokit: async () => octokit } });
    const patch = { title: current.title, addLabels: [], assignees: ["maintainer"],
      expected: { title: current.title, body: current.body, labels: ["bug"], assignees: ["existing"] } };
    await client.applyIssueTriage(request, patch);
    accepted = false;
    await assert.rejects(client.applyIssueTriage(request, patch), /not assignable/);
  });

  it("fetches only the configured issue form from the default branch", async () => {
    const client = new GitHubClient(1, "unused", "secret");
    const octokit = { rest: { repos: { getContent: async (input: { path: string; ref: string }) => {
      assert.equal(input.path, ".github/ISSUE_TEMPLATE/feature.yml");
      assert.equal(input.ref, "main");
      return { data: { type: "file", encoding: "base64", size: 10, content: Buffer.from("body: []").toString("base64") } };
    } } } };
    Object.assign(client, { app: { getInstallationOctokit: async () => octokit } });
    client.getDefaultBranch = async () => "main";
    assert.equal(await client.readIssueTemplate(request, ".github/ISSUE_TEMPLATE/feature.yml"), "body: []");
    await assert.rejects(client.readIssueTemplate(request, "README.md"));
  });
});
