import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  AssetRipperReadSession,
  CodexPort,
  CodexResult,
  GitHubReadSession,
  ReasoningEffort,
} from "./types.js";
import { sanitizedEnvironment } from "./environment.js";

const AUTOMATION_SCHEMA_VERSION = "spark.automation.v1";
const MAX_PROCESS_OUTPUT_BYTES = 10 * 1024 * 1024;

export interface SparkProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type SparkProcessRunner = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    input: string;
    timeoutMs: number;
  },
) => Promise<SparkProcessResult>;

interface SparkAutomationRequest {
  schema_version: typeof AUTOMATION_SCHEMA_VERSION;
  request_id: string;
  cwd: string;
  prompt: string;
  model: string;
  reasoning_effort: ReasoningEffort;
  output_schema: object;
  output_schema_name: "diffuin_artifact";
  read_roots: readonly string[];
  tool_policy: {
    workspace_writes: true;
    allow_unsandboxed_commands: boolean;
  };
  mcp_servers: Array<{
    name: string;
    url: string;
    bearer_token_env_var: string;
  }>;
}

interface SparkAutomationResponse {
  schema_version: typeof AUTOMATION_SCHEMA_VERSION;
  request_id: string;
  status: "completed" | "failed";
  final_response?: string;
  error?: string;
}

export class SparkClient implements CodexPort {
  constructor(
    private readonly command: string,
    private readonly dataDir: string,
    private readonly timeoutMs: number,
    private readonly allowUnsandboxedCommands: boolean,
    private readonly processRunner: SparkProcessRunner = runSparkProcess,
  ) {}

  async run(
    workingDirectory: string,
    prompt: string,
    options: {
      model: string;
      reasoningEffort: ReasoningEffort;
      outputSchema: object;
      readRoots?: readonly string[];
      githubReadSession?: GitHubReadSession;
      assetRipperReadSession?: AssetRipperReadSession;
    },
  ): Promise<CodexResult> {
    const request = buildSparkAutomationRequest(
      randomUUID(),
      workingDirectory,
      prompt,
      options,
      this.allowUnsandboxedCommands,
    );
    const result = await this.processRunner(this.command, ["automation", "--stdio"], {
      cwd: workingDirectory,
      env: sanitizedEnvironment({
        CODEX_HOME: join(this.dataDir, "codex-home"),
        ...(options.githubReadSession
          ? { DIFFUIN_GITHUB_READ_TOKEN: options.githubReadSession.token }
          : {}),
        ...(options.assetRipperReadSession
          ? { DIFFUIN_ASSETRIPPER_READ_TOKEN: options.assetRipperReadSession.token }
          : {}),
      }),
      input: JSON.stringify(request),
      timeoutMs: this.timeoutMs,
    });
    const response = parseSparkAutomationResponse(result.stdout, request.request_id);
    if (response.status === "failed") {
      throw new Error(`Spark automation failed: ${response.error ?? "unknown error"}`);
    }
    if (result.exitCode !== 0) {
      throw new Error(processFailureMessage(result));
    }
    if (!response.final_response) {
      throw new Error("Spark automation completed without returning a final response");
    }
    return {
      finalResponse: response.final_response,
      threadId: `spark:${request.request_id}`,
      provider: "spark",
    };
  }
}

export function buildSparkAutomationRequest(
  requestId: string,
  workingDirectory: string,
  prompt: string,
  options: {
    model: string;
    reasoningEffort: ReasoningEffort;
    outputSchema: object;
    readRoots?: readonly string[];
    githubReadSession?: GitHubReadSession;
    assetRipperReadSession?: AssetRipperReadSession;
  },
  allowUnsandboxedCommands: boolean,
): SparkAutomationRequest {
  const mcpServers: SparkAutomationRequest["mcp_servers"] = [];
  if (options.githubReadSession) {
    mcpServers.push({
      name: "diffuin_github",
      url: options.githubReadSession.url,
      bearer_token_env_var: "DIFFUIN_GITHUB_READ_TOKEN",
    });
  }
  if (options.assetRipperReadSession) {
    mcpServers.push({
      name: "diffuin_assetripper",
      url: options.assetRipperReadSession.url,
      bearer_token_env_var: "DIFFUIN_ASSETRIPPER_READ_TOKEN",
    });
  }
  return {
    schema_version: AUTOMATION_SCHEMA_VERSION,
    request_id: requestId,
    cwd: workingDirectory,
    prompt,
    model: options.model,
    reasoning_effort: options.reasoningEffort,
    output_schema: options.outputSchema,
    output_schema_name: "diffuin_artifact",
    read_roots: options.readRoots ?? [],
    tool_policy: {
      workspace_writes: true,
      allow_unsandboxed_commands: allowUnsandboxedCommands,
    },
    mcp_servers: mcpServers,
  };
}

export function parseSparkAutomationResponse(
  stdout: string,
  expectedRequestId: string,
): SparkAutomationResponse {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    throw new Error("Spark automation returned invalid JSON");
  }
  if (!isRecord(value) || value.schema_version !== AUTOMATION_SCHEMA_VERSION) {
    throw new Error("Spark automation returned an unsupported response schema");
  }
  if (value.request_id !== expectedRequestId) {
    throw new Error("Spark automation response did not match the request ID");
  }
  if (value.status !== "completed" && value.status !== "failed") {
    throw new Error("Spark automation returned an invalid status");
  }
  if (value.final_response !== undefined && typeof value.final_response !== "string") {
    throw new Error("Spark automation returned an invalid final response");
  }
  if (value.error !== undefined && typeof value.error !== "string") {
    throw new Error("Spark automation returned an invalid error");
  }
  return value as unknown as SparkAutomationResponse;
}

export const runSparkProcess: SparkProcessRunner = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  let settled = false;

  const finish = (error?: Error, exitCode: number | null = null): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve({ stdout, stderr, exitCode });
  };
  const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
    outputBytes += chunk.byteLength;
    if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
      child.kill();
      finish(new Error("Spark automation exceeded the process output limit"));
      return;
    }
    if (target === "stdout") stdout += chunk.toString("utf8");
    else stderr += chunk.toString("utf8");
  };
  const timer = setTimeout(() => {
    child.kill();
    finish(new Error(`Spark automation timed out after ${options.timeoutMs}ms`));
  }, options.timeoutMs);

  child.once("error", (error) => finish(error));
  child.once("close", (code) => finish(undefined, code));
  child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
  child.stdin.on("error", (error) => finish(error));
  child.stdin.end(options.input, "utf8");
});

function processFailureMessage(result: SparkProcessResult): string {
  const detail = result.stderr.trim().slice(0, 1000);
  return `Spark automation exited with code ${result.exitCode}${detail ? `: ${detail}` : ""}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
