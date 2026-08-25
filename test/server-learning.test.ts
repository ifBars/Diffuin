import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { Config } from "../src/config.js";
import { createDiffuinServer } from "../src/server.js";
import { JobStore } from "../src/store.js";
import type { GitHubPort } from "../src/types.js";

describe("server learning ingress", () => {
  const servers: ReturnType<typeof createDiffuinServer>[] = [];
  const stores: JobStore[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
    for (const store of stores.splice(0)) store.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("authorizes, stores, and acknowledges an idempotent repository memory", async () => {
    const directory = mkdtempSync(join(tmpdir(), "diffuin-server-learning-"));
    directories.push(directory);
    const store = new JobStore(join(directory, "diffuin.sqlite"));
    stores.push(store);
    const comments: string[] = [];
    const github: GitHubPort = {
      getActorPermission: async () => "maintain",
      getTrustedReferenceSha: async () => "trusted-base-sha",
      addReaction: async () => undefined,
      comment: async (_request, body) => { comments.push(body); return 500; },
      updateComment: async () => undefined,
      reviewPullRequest: async () => [],
      getDefaultBranch: async () => "main",
      getIssue: async () => ({ title: "", body: null }),
      getPullRequest: async () => { throw new Error("unused"); },
      updateIssue: async () => undefined,
      getInstallationToken: async () => "token",
      createPullRequest: async () => ({ number: 1, url: "https://example.test/1" }),
    };
    const secret = "a-long-test-webhook-secret";
    const config = {
      agentProfile: "general",
      githubWebhookSecret: secret,
      handle: "Diffuin",
      allowedRepositories: new Set(["octo-org/example-repo"]),
    } as unknown as Config;
    const server = createDiffuinServer(config, store, github);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const body = JSON.stringify({
      action: "created",
      installation: { id: 42 },
      repository: { id: 7, full_name: "octo-org/example-repo" },
      sender: { login: "maintainer", type: "User" },
      issue: { number: 12 },
      comment: {
        id: 99,
        body: "@Diffuin remember warning for this repository: Generated clients must be regenerated",
        user: { login: "maintainer", type: "User" },
      },
    });
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const response = await fetch(`http://127.0.0.1:${address.port}/webhooks/github`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "issue_comment",
        "x-github-delivery": "delivery-1",
        "x-hub-signature-256": signature,
      },
      body,
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { status: "memory_updated" });
    const memories = store.listMemories({ repositoryId: 7, actor: "maintainer" });
    assert.equal(memories.length, 1);
    assert.equal(memories[0]?.sourceSha, "trusted-base-sha");
    assert.match(comments[0] ?? "", /saved repository memory/);
  });
});
