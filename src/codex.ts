import { Codex, type CodexOptions, type ThreadEvent } from "@openai/codex-sdk";
import { join } from "node:path";
import type {
  AssetRipperReadSession,
  CodexPort,
  CodexResult,
  GitHubReadSession,
  ReasoningEffort,
} from "./types.js";
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
      assetRipperReadSession?: AssetRipperReadSession;
    },
  ): Promise<CodexResult> {
    const config = buildCodexConfig(
      options.reasoningEffort,
      options.githubReadSession,
      options.assetRipperReadSession,
    );
    const codex = new Codex({
      config,
      env: sanitizedEnvironment({
        CODEX_HOME: join(this.dataDir, "codex-home"),
        ...(options.githubReadSession
          ? { DIFFUIN_GITHUB_READ_TOKEN: options.githubReadSession.token }
          : {}),
        ...(options.assetRipperReadSession
          ? { DIFFUIN_ASSETRIPPER_READ_TOKEN: options.assetRipperReadSession.token }
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
  githubSession?: GitHubReadSession,
  assetRipperSession?: AssetRipperReadSession,
): NonNullable<CodexOptions["config"]> {
  return {
    model_reasoning_effort: reasoningEffort,
    features: { apps: false, plugins: false },
    ...((githubSession || assetRipperSession) ? {
      mcp_servers: {
        ...(githubSession ? {
          diffuin_github: {
            url: githubSession.url,
            bearer_token_env_var: "DIFFUIN_GITHUB_READ_TOKEN",
            enabled: true,
            required: true,
          },
        } : {}),
        ...(assetRipperSession ? {
          diffuin_assetripper: {
            url: assetRipperSession.url,
            bearer_token_env_var: "DIFFUIN_ASSETRIPPER_READ_TOKEN",
            enabled: true,
            required: true,
          },
        } : {}),
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
