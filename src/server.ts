import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import type { GitHubPort } from "./types.js";
import { canWrite } from "./mention.js";
import { validateOverrides } from "./routing.js";
import { verifyGitHubSignature } from "./signature.js";
import { JobStore } from "./store.js";
import { parseWorkRequest } from "./webhook.js";

const MAX_WEBHOOK_BYTES = 1024 * 1024;

export function createDiffuinServer(config: Config, store: JobStore, github: GitHubPort) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        return json(response, 200, { status: "ok" });
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

      const work = parseWorkRequest(eventName, deliveryId, JSON.parse(rawBody.toString("utf8")), config.handle);
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
          `Diffuin could not queue this request.\n\n\`${commandError.replace(/`/g, "'")}\`\n\n` +
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
