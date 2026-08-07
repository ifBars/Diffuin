import type { WorkRequest } from "./types.js";
import { parseMention } from "./mention.js";

interface WebhookPayload {
  action?: string;
  installation?: { id?: number };
  repository?: { id?: number; full_name?: string; name?: string; owner?: { login?: string } };
  sender?: { login?: string; type?: string };
  issue?: { number?: number; pull_request?: unknown };
  pull_request?: { number?: number };
  comment?: { id?: number; body?: string; user?: { login?: string; type?: string } };
}

export function parseWorkRequest(
  eventName: string,
  deliveryId: string,
  payload: WebhookPayload,
  handle: string,
): WorkRequest | null {
  if (payload.action !== "created") {
    return null;
  }

  if (eventName !== "issue_comment" && eventName !== "pull_request_review_comment") {
    return null;
  }

  const body = payload.comment?.body;
  const command = body ? parseMention(body, handle) : null;
  const repository = payload.repository?.full_name;
  const issueNumber = eventName === "issue_comment" ? payload.issue?.number : payload.pull_request?.number;
  const actor = payload.comment?.user?.login ?? payload.sender?.login;
  const actorType = payload.comment?.user?.type ?? payload.sender?.type;
  if (!command || !repository || !issueNumber || !actor || actorType === "Bot") {
    return null;
  }

  const [owner, repo, extra] = repository.split("/");
  const installationId = payload.installation?.id;
  const repositoryId = payload.repository?.id;
  const commentId = payload.comment?.id;
  if (!owner || !repo || extra || !installationId || !repositoryId || !commentId) {
    throw new Error("GitHub webhook is missing required installation or repository fields");
  }

  return {
    deliveryId,
    installationId,
    repositoryId,
    repository,
    owner,
    repo,
    issueNumber,
    commentId,
    actor,
    kind:
      eventName === "pull_request_review_comment" || payload.issue?.pull_request
        ? "pull_request"
        : "issue",
    task: command.task,
    mode: command.mode,
    requestedModel: command.requestedModel,
    requestedReasoningEffort: command.requestedReasoningEffort,
    commandError: command.error,
  };
}
