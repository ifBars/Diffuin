import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.js";

const baseEnvironment: NodeJS.ProcessEnv = {
  GITHUB_APP_ID: "1",
  GITHUB_PRIVATE_KEY_BASE64: Buffer.from("test-key").toString("base64"),
  GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
  ALLOWED_REPOSITORIES: "octo-org/example",
};

describe("loadConfig profiles", () => {
  it("defaults to the current model tiers and a Luna routing advisor", () => {
    const config = loadConfig(baseEnvironment);
    assert.equal(config.codexModel, "gpt-6-luna");
    assert.equal(config.routingAdvisorModel, "gpt-6-luna");
    assert.deepEqual([...config.allowedCodexModels], [
      "gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra", "gpt-5.3-codex-spark",
    ]);
  });

  it("preserves the Schedule One profile for existing deployments", () => {
    const config = loadConfig(baseEnvironment);

    assert.equal(config.agentProfile, "schedule-one");
    assert.match(config.scheduleOneSkillPath, /skills[\\/]schedule-one-modding$/);
  });

  it("selects the domain-neutral profile independently of Schedule One settings", () => {
    const config = loadConfig({ ...baseEnvironment, DIFFUIN_PROFILE: "general", SKILL_ROOT: "./skills" });

    assert.equal(config.agentProfile, "general");
    assert.match(config.skillRoot, /skills$/);
  });
});
