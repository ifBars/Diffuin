import type { WorkRequest } from "./types.js";
import { parseMention } from "./mention.js";
import { isPlanActionChecked } from "./plan-action.js";

interface WebhookPayload {
  action?: string;
  installation?: { id?: number };
  repository?: { id?: number; full_name?: string; name?: string; owner?: { login?: string } };
  sender?: { login?: string; type?: string };
  issue?: { number?: number; pull_request?: unknown };
  pull_request?: { number?: number };
  comment?: { id?: number; body?: string; user?: { login?: string; type?: string } };
  changes?: { body?: { from?: string } };
}

export function parseWorkRequest(
  eventName: string,
  deliveryId: string,
  payload: WebhookPayload,
  handle: string,
): WorkRequest | null {
  if (eventName !== "issue_comment" && eventName !== "pull_request_review_comment") {
    return null;
  }

  if (eventName === "issue_comment" && payload.action === "edited") {
    return parsePlanActionRequest(payload, handle);
  }

  if (payload.action !== "created") return null;

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
    closeIssueOnMerge: false,
    requestedModel: command.requestedModel,
    requestedReasoningEffort: command.requestedReasoningEffort,
    commandError: command.error,
  };
}

function parsePlanActionRequest(payload: WebhookPayload, handle: string): WorkRequest | null {
  const body = payload.comment?.body;
  const previousBody = payload.changes?.body?.from;
  const commentAuthor = payload.comment?.user;
  const actor = payload.sender?.login;
  if (
    !body || !previousBody || !isPlanActionChecked(previousBody, body) ||
    payload.issue?.pull_request || commentAuthor?.type !== "Bot" ||
    !isDiffuinLogin(commentAuthor.login, handle) || !actor || payload.sender?.type === "Bot"
  ) {
    return null;
  }

  const repository = payload.repository?.full_name;
  const [owner, repo, extra] = repository?.split("/") ?? [];
  const installationId = payload.installation?.id;
  const repositoryId = payload.repository?.id;
  const issueNumber = payload.issue?.number;
  const commentId = payload.comment?.id;
  if (!repository || !owner || !repo || extra || !installationId || !repositoryId || !issueNumber || !commentId) {
    throw new Error("GitHub webhook is missing required installation or repository fields");
  }

  return {
    deliveryId: `plan-action:${repositoryId}:${commentId}`,
    installationId,
    repositoryId,
    repository,
    owner,
    repo,
    issueNumber,
    commentId,
    actor,
    kind: "issue",
    task: `Implement the approved plan in Diffuin comment #${commentId}. Create a pull request that implements the complete plan and closes issue #${issueNumber} when merged.`,
    mode: "implement",
    closeIssueOnMerge: true,
  };
}

function isDiffuinLogin(login: string | undefined, handle: string): boolean {
  const normalized = login?.toLowerCase();
  const expected = handle.toLowerCase();
  return normalized === expected || normalized === `${expected}[bot]`;
}
