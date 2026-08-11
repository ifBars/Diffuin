import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ModelRoutedHarness } from "../src/harness.js";
import {
  SparkClient,
  buildSparkAutomationRequest,
  parseSparkAutomationResponse,
  type SparkProcessRunner,
} from "../src/spark.js";
import type { CodexPort } from "../src/types.js";

const githubSession = {
  url: "http://127.0.0.1:3210/mcp",
  token: "github-session-secret",
  repositories: ["ifBars/S1API"],
  close: () => undefined,
};

describe("Spark automation provider", () => {
  it("builds a structured request with read roots and credential references only", () => {
    const request = buildSparkAutomationRequest(
      "job-42",
      "C:/work/repo",
      "Review the pull request.",
      {
        model: "gpt-5.3-codex-spark",
        reasoningEffort: "medium",
        outputSchema: { type: "object" },
        readRoots: ["C:/references/source"],
        githubReadSession: githubSession,
      },
      false,
    );

    assert.equal(request.schema_version, "spark.automation.v1");
    assert.deepEqual(request.read_roots, ["C:/references/source"]);
    assert.deepEqual(request.tool_policy, {
      workspace_writes: true,
      allow_unsandboxed_commands: false,
    });
    assert.deepEqual(request.mcp_servers, [{
      name: "diffuin_github",
      url: githubSession.url,
      bearer_token_env_var: "DIFFUIN_GITHUB_READ_TOKEN",
    }]);
    assert.doesNotMatch(JSON.stringify(request), /github-session-secret/);
  });

  it("maps a successful automation response to the shared harness result", async () => {
    let capturedInput = "";
    let capturedEnvironment: Record<string, string> = {};
    const runner: SparkProcessRunner = async (_command, args, options) => {
      assert.deepEqual(args, ["automation", "--stdio"]);
      capturedInput = options.input;
      capturedEnvironment = options.env;
      const request = JSON.parse(options.input) as { request_id: string };
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          schema_version: "spark.automation.v1",
          request_id: request.request_id,
          status: "completed",
          final_response: '{"kind":"review"}',
        }),
      };
    };
    const client = new SparkClient("spark-custom", "C:/data", 15_000, false, runner);
    const result = await client.run("C:/work/repo", "Review it.", {
      model: "gpt-5.3-codex-spark",
      reasoningEffort: "medium",
      outputSchema: { type: "object" },
      githubReadSession: githubSession,
    });

    assert.equal(result.finalResponse, '{"kind":"review"}');
    assert.equal(result.provider, "spark");
    assert.match(result.threadId, /^spark:/);
    assert.doesNotMatch(capturedInput, /github-session-secret/);
    assert.equal(capturedEnvironment.DIFFUIN_GITHUB_READ_TOKEN, "github-session-secret");
    assert.match(capturedEnvironment.CODEX_HOME ?? "", /codex-home$/);
  });

  it("rejects failed and mismatched protocol responses", () => {
    assert.throws(
      () => parseSparkAutomationResponse('{"schema_version":"spark.automation.v1","request_id":"other","status":"completed"}', "job-42"),
      /request ID/,
    );
    assert.throws(() => parseSparkAutomationResponse("not json", "job-42"), /invalid JSON/);
  });
});

describe("model-routed harness", () => {
  it("uses Spark only for configured Spark models", async () => {
    const calls: string[] = [];
    const provider = (name: string): CodexPort => ({
      run: async () => {
        calls.push(name);
        return { finalResponse: "{}", threadId: name };
      },
    });
    const harness = new ModelRoutedHarness(
      provider("codex"),
      provider("spark"),
      new Set(["gpt-5.3-codex-spark"]),
    );
    const common = { reasoningEffort: "medium" as const, outputSchema: {} };

    await harness.run("C:/work", "review", { ...common, model: "gpt-5.6-terra" });
    await harness.run("C:/work", "review", { ...common, model: "gpt-5.3-codex-spark" });

    assert.deepEqual(calls, ["codex", "spark"]);
  });
});
