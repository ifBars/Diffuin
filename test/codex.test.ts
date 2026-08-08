import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ThreadEvent } from "@openai/codex-sdk";
import { buildCodexConfig, readFinalResponse } from "../src/codex.js";

describe("readFinalResponse", () => {
  it("retains only the latest completed agent message", async () => {
    const events = stream([
      { type: "thread.started", thread_id: "thread-1" },
      { type: "turn.started" },
      { type: "item.completed", item: { id: "message-1", type: "agent_message", text: "draft" } },
      { type: "item.completed", item: { id: "message-2", type: "agent_message", text: "final plan" } },
      {
        type: "turn.completed",
        usage: {
          input_tokens: 10,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 5,
          reasoning_output_tokens: 2,
        },
      },
    ]);

    assert.equal(await readFinalResponse(events), "final plan");
  });

  it("surfaces fatal stream errors", async () => {
    await assert.rejects(
      readFinalResponse(stream([{ type: "turn.failed", error: { message: "worker terminated" } }])),
      /worker terminated/,
    );
  });
});

describe("buildCodexConfig", () => {
  it("registers only the short-lived read broker credential", () => {
    const config = buildCodexConfig("xhigh", {
      url: "http://127.0.0.1:3210/mcp",
      token: "not-part-of-config",
      repositories: ["ifBars/S1API"],
      close: () => undefined,
    });

    assert.deepEqual(config.mcp_servers, {
      diffuin_github: {
        url: "http://127.0.0.1:3210/mcp",
        bearer_token_env_var: "DIFFUIN_GITHUB_READ_TOKEN",
        enabled: true,
        required: true,
      },
    });
    assert.doesNotMatch(JSON.stringify(config), /not-part-of-config/);
  });
});

async function* stream(events: ThreadEvent[]): AsyncGenerator<ThreadEvent> {
  for (const event of events) {
    yield event;
  }
}
