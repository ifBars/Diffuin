import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { discoverMentionedRepositories, GitHubReadBroker } from "../src/github-read-broker.js";
import type { GitHubReadSource, IssueContext, WorkRequest } from "../src/types.js";

const request: WorkRequest = {
  deliveryId: "delivery",
  installationId: 1,
  repositoryId: 2,
  repository: "ifBars/S1API",
  owner: "ifBars",
  repo: "S1API",
  issueNumber: 217,
  commentId: 5,
  actor: "ifBars",
  kind: "issue",
  task: "Compare k073l/s1-codearchiver with https://github.com/ifBars/MoreDrugs/issues/12",
  mode: "investigate",
};

const context: IssueContext = {
  title: "Persistence issue",
  body: "See https://github.com/ifBars/MoreDrugs/pull/9 for the consumer behavior.",
  comments: [{ id: 4, author: "maintainer", body: "Also compare https://github.com/ifBars/S1API." }],
};

describe("GitHubReadBroker", () => {
  it("discovers and deduplicates only explicit repository references", () => {
    assert.deepEqual(discoverMentionedRepositories(request, context), [
      "ifBars/S1API",
      "ifBars/MoreDrugs",
      "k073l/s1-codearchiver",
    ]);
  });

  it("serves read-only MCP tools and rejects missing or out-of-scope credentials", async () => {
    const calls: string[] = [];
    const source: GitHubReadSource = {
      readRepository: async (_request, repository) => {
        calls.push(repository);
        return { repository, defaultBranch: "main" };
      },
      readFile: async () => ({}),
      searchCode: async () => ({}),
      readIssue: async () => ({}),
      readPullRequest: async () => ({}),
    };
    const broker = new GitHubReadBroker(source);
    await broker.start();
    const session = broker.openSession(request, context);
    const unauthenticated = await fetch(session.url, { method: "POST" });
    assert.equal(unauthenticated.status, 401);

    const client = new Client({ name: "diffuin-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(session.url), {
      requestInit: { headers: { Authorization: `Bearer ${session.token}` } },
    });
    try {
      await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
        "github_get_file",
        "github_get_issue",
        "github_get_pull_request",
        "github_get_repository",
        "github_search_code",
      ]);
      const allowed = await client.callTool({
        name: "github_get_repository",
        arguments: { repository: "ifBars/MoreDrugs" },
      });
      assert.equal(allowed.isError, undefined);
      assert.match(JSON.stringify(allowed.content), /defaultBranch/);
      const denied = await client.callTool({
        name: "github_get_repository",
        arguments: { repository: "private/Unmentioned" },
      });
      assert.equal(denied.isError, true);
      assert.deepEqual(calls, ["ifBars/MoreDrugs"]);
    } finally {
      await client.close();
      session.close();
      await broker.stop();
    }
  });
});
