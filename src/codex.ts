import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import { join } from "node:path";
import type { CodexPort, CodexResult } from "./types.js";
import { sanitizedEnvironment } from "./environment.js";

export class CodexClient implements CodexPort {
  private readonly codex: Codex;

  constructor(
    private readonly model: string,
    reasoningEffort: string,
    dataDir: string,
  ) {
    this.codex = new Codex({
      config: {
        model_reasoning_effort: reasoningEffort,
        features: { apps: false, plugins: false },
      },
      env: sanitizedEnvironment({ CODEX_HOME: join(dataDir, "codex-home") }),
    });
  }

  async run(workingDirectory: string, prompt: string): Promise<CodexResult> {
    const thread = this.codex.startThread({
      model: this.model,
      workingDirectory,
      sandboxMode: "workspace-write",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      approvalPolicy: "never",
    });
    const { events } = await thread.runStreamed(prompt);
    const finalResponse = await readFinalResponse(events);
    if (!thread.id) {
      throw new Error("Codex completed without returning a thread ID");
    }
    return { finalResponse, threadId: thread.id };
  }
}

export async function readFinalResponse(events: AsyncIterable<ThreadEvent>): Promise<string> {
  let finalResponse = "";
  for await (const event of events) {
    if (event.type === "item.completed" && event.item.type === "agent_message") {
      finalResponse = event.item.text;
      continue;
    }
    if (event.type === "turn.failed") {
      throw new Error(event.error.message);
    }
    if (event.type === "error") {
      throw new Error(event.message);
    }
  }
  if (!finalResponse) {
    throw new Error("Codex completed without returning a final response");
  }
  return finalResponse;
}
