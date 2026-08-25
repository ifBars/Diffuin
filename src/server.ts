import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import type { GitHubPort } from "./types.js";
import { canWrite } from "./mention.js";
import { validateOverrides } from "./routing.js";
import { verifyGitHubSignature } from "./signature.js";
import { JobStore } from "./store.js";
import { parseWorkRequest } from "./webhook.js";
import { parseFeedbackEvent, parseMemoryCommand, parsePullRequestOutcome } from "./learning.js";

const MAX_WEBHOOK_BYTES = 1024 * 1024;

export function createDiffuinServer(config: Config, store: JobStore, github: GitHubPort) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        return json(response, 200, {
          status: "ok",
          profile: config.agentProfile,
          connectors: ["github"],
        });
      }
      if (request.method !== "POST" || request.url !== "/webhooks/github") {
        return json(response, 404, { error: "not_found" });
      }

      const rawBody = await readBody(request);
      if (!verifyGitHubSignature(rawBody, header(request, "x-hub-signature-256"), config.githubWebhookSecret)) {
        return json(response, 401, { error: "invalid_signature" });
      }

      const eventName = header(request, "x-github-event");
      const deliveryId = header(request, "x-github-delivery");
      if (!eventName || !deliveryId) {
        return json(response, 400, { error: "missing_github_headers" });
      }
      if (eventName === "ping") {
        return json(response, 200, { status: "pong" });
      }

      const payload = JSON.parse(rawBody.toString("utf8"));
      const outcome = parsePullRequestOutcome(eventName, deliveryId, payload);
      if (outcome) {
        if (!config.allowedRepositories.has(outcome.repository.toLowerCase())) {
          return json(response, 202, { status: "repository_not_allowed" });
        }
        const recorded = store.recordPullRequestOutcome(outcome);
        return json(response, 202, { status: recorded ? "outcome_recorded" : "outcome_ignored" });
      }

      const feedback = parseFeedbackEvent(eventName, deliveryId, payload);
      if (feedback) {
        if (!config.allowedRepositories.has(feedback.repository.toLowerCase())) {
          return json(response, 202, { status: "repository_not_allowed" });
        }
        const permission = await github.getActorPermission(feedback);
        if (!canWrite(permission)) {
          return json(response, 202, { status: "actor_not_authorized" });
        }
        const recorded = store.recordFeedback(feedback);
        return json(response, 202, { status: recorded ? "feedback_recorded" : "feedback_ignored" });
      }

      const memoryCommand = parseMemoryCommand(eventName, deliveryId, payload, config.handle);
      if (memoryCommand) {
        if (!config.allowedRepositories.has(memoryCommand.repository.toLowerCase())) {
          return json(response, 202, { status: "repository_not_allowed" });
        }
        const permission = await github.getActorPermission(memoryCommand);
        if (!canWrite(permission)) {
          return json(response, 202, { status: "actor_not_authorized" });
        }
        await handleMemoryCommand(store, github, memoryCommand);
        return json(response, 202, { status: "memory_updated" });
      }

      const work = parseWorkRequest(eventName, deliveryId, payload, config.handle);
      if (!work) {
        return json(response, 202, { status: "ignored" });
      }
      if (!config.allowedRepositories.has(work.repository.toLowerCase())) {
        return json(response, 202, { status: "repository_not_allowed" });
      }

      const permission = await github.getActorPermission(work);
      if (!canWrite(permission)) {
        return json(response, 202, { status: "actor_not_authorized" });
      }

      const commandError = validateOverrides(work, config);
      if (commandError) {
        await github.addReaction(work, "confused").catch(() => undefined);
        await github.comment(
          work,
          `I couldn't queue this request.\n\n\`${commandError.replace(/`/g, "'")}\`\n\n` +
          "Use `@Diffuin review|investigate|plan|implement|answer --model <model> --effort <level> -- <instructions>`."
        ).catch(() => undefined);
        return json(response, 202, { status: "invalid_command" });
      }

      const job = store.enqueue(work);
      if (!job) {
        return json(response, 202, { status: "duplicate" });
      }
      await github.addReaction(work, "eyes");
      return json(response, 202, { status: "queued", jobId: job.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Webhook handling failed", { message });
      return json(response, 500, { error: "internal_error" });
    }
  });
}

async function handleMemoryCommand(
  store: JobStore,
  github: GitHubPort,
  command: import("./types.js").MemoryCommand,
): Promise<void> {
  if (command.memoryAction === "remember") {
    command.memorySourceSha = await github.getTrustedReferenceSha?.(command);
    const memory = store.remember(command);
    await github.addReaction(command, "+1").catch(() => undefined);
    await github.comment(
      command,
      `I saved repository memory \`${memory.id}\` with ${memory.scope} scope. ` +
      "It will supplement tracked guidance on relevant future runs; it cannot override `AGENTS.md` or safety policy.",
    );
    return;
  }
  if (command.memoryAction === "forget") {
    const forgotten = store.forgetMemory(command);
    await github.comment(
      command,
      forgotten
        ? `I retired memory \`${command.memoryId}\`.`
        : `I couldn't find an active memory \`${command.memoryId}\` that you can retire in this repository.`,
    );
    return;
  }
  const memories = store.listMemories(command);
  const body = memories.length
    ? memories.map((memory) => {
      const path = memory.pathGlob ? ` · \`${memory.pathGlob}\`` : "";
      return `- \`${memory.id}\` · ${memory.kind} · ${memory.scope}${path}\n  ${safeMarkdown(memory.text)}\n  [Evidence](${memory.evidenceUrl})`;
    }).join("\n")
    : "No active repository or personal memories are available for this repository.";
  await github.comment(command, `## Diffuin memory\n\n${body}`);
}

function safeMarkdown(value: string): string {
  return value.replace(/@/g, "@\u200b").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_WEBHOOK_BYTES) {
      throw new Error("Webhook payload exceeds 1 MiB");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function json(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
