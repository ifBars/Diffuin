import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import type { Config } from "../src/config.js";
import { createDiffuinServer } from "../src/server.js";
import type { GitHubPort } from "../src/types.js";
import type { JobStore } from "../src/store.js";

describe("server health", () => {
  const servers: ReturnType<typeof createDiffuinServer>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
  });

  it("reports the active profile and enabled connectors", async () => {
    const config = { agentProfile: "general" } as Config;
    const server = createDiffuinServer(config, {} as JobStore, {} as GitHubPort);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      profile: "general",
      connectors: ["github"],
    });
  });
});
