import { Codex, type CodexOptions, type ThreadEvent } from "@openai/codex-sdk";
import { join } from "node:path";
import type { CodexPort, CodexResult, GitHubReadSession, ReasoningEffort } from "./types.js";
import { sanitizedEnvironment } from "./environment.js";

export class CodexClient implements CodexPort {
  constructor(private readonly dataDir: string) {}

  async run(
    workingDirectory: string,
    prompt: string,
    options: {
      model: string;
      reasoningEffort: ReasoningEffort;
      outputSchema: object;
      githubReadSession?: GitHubReadSession;
    },
  ): Promise<CodexResult> {
    const config = buildCodexConfig(options.reasoningEffort, options.githubReadSession);
    const codex = new Codex({
      config,
      env: sanitizedEnvironment({
        CODEX_HOME: join(this.dataDir, "codex-home"),
        ...(options.githubReadSession
          ? { DIFFUIN_GITHUB_READ_TOKEN: options.githubReadSession.token }
          : {}),
      }),
    });
    const thread = codex.startThread({
      model: options.model,
      workingDirectory,
      sandboxMode: "workspace-write",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      approvalPolicy: "never",
    });
    const { events } = await thread.runStreamed(prompt, { outputSchema: options.outputSchema });
    const finalResponse = await readFinalResponse(events);
    if (!thread.id) {
      throw new Error("Codex completed without returning a thread ID");
    }
    return { finalResponse, threadId: thread.id };
  }
}

export function buildCodexConfig(
  reasoningEffort: ReasoningEffort,
  session?: GitHubReadSession,
): NonNullable<CodexOptions["config"]> {
  return {
    model_reasoning_effort: reasoningEffort,
    features: { apps: false, plugins: false },
    ...(session ? {
      mcp_servers: {
        diffuin_github: {
          url: session.url,
          bearer_token_env_var: "DIFFUIN_GITHUB_READ_TOKEN",
          enabled: true,
          required: true,
        },
      },
    } : {}),
  };
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
