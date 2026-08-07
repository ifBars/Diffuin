import { Codex } from "@openai/codex-sdk";
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
      config: { model_reasoning_effort: reasoningEffort },
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
    const result = await thread.run(prompt);
    if (!thread.id) {
      throw new Error("Codex completed without returning a thread ID");
    }
    return { finalResponse: result.finalResponse, threadId: thread.id };
  }
}
