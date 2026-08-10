import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AssetRipperReadBroker } from "../src/assetripper-read-broker.js";

describe("AssetRipperReadBroker", () => {
  it("serves bounded private-corpus discovery, search, and reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "diffuin-assetripper-"));
    await mkdir(join(root, "Scenes"));
    await writeFile(join(root, "Scenes", "Main.unity"), [
      "%YAML 1.1",
      "--- !u!1 &1",
      "GameObject:",
      "  m_Name: Laundromat",
      "--- !u!4 &2",
      "Transform:",
      "  m_GameObject: {fileID: 1}",
    ].join("\n"));

    const broker = new AssetRipperReadBroker();
    await broker.start();
    const session = await broker.openSession(root);
    assert.ok(session);
    const unauthenticated = await fetch(session.url, { method: "POST" });
    assert.equal(unauthenticated.status, 401);

    const client = new Client({ name: "diffuin-asset-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(session.url), {
      requestInit: { headers: { Authorization: `Bearer ${session.token}` } },
    });
    try {
      await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
        "assetripper_find_paths",
        "assetripper_list_directory",
        "assetripper_read_file",
        "assetripper_search",
      ]);

      const found = await client.callTool({
        name: "assetripper_find_paths",
        arguments: { query: "main" },
      });
      assert.match(JSON.stringify(found.content), /Scenes\/Main\.unity/);

      const searched = await client.callTool({
        name: "assetripper_search",
        arguments: { query: "Laundromat", extensions: [".unity"] },
      });
      assert.match(JSON.stringify(searched.content), /Laundromat/);

      const read = await client.callTool({
        name: "assetripper_read_file",
        arguments: { path: "Scenes/Main.unity", startLine: 3, endLine: 4 },
      });
      assert.match(JSON.stringify(read.content), /GameObject/);
      assert.match(JSON.stringify(read.content), /Laundromat/);

      const escaped = await client.callTool({
        name: "assetripper_read_file",
        arguments: { path: "../outside.txt" },
      });
      assert.equal(escaped.isError, true);
    } finally {
      await client.close();
      session.close();
      await broker.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
