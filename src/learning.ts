import type { FeedbackEvent, MemoryCommand, MemoryKind, MemoryScope, WorkRequest } from "./types.js";
import { parseMention } from "./mention.js";

interface LearningPayload {
  action?: string;
  installation?: { id?: number };
  repository?: { id?: number; full_name?: string };
  sender?: { login?: string; type?: string };
  issue?: { number?: number; pull_request?: unknown };
  pull_request?: { number?: number; body?: string | null; merged?: boolean; merge_commit_sha?: string | null };
  comment?: {
    id?: number;
    body?: string;
    in_reply_to_id?: number;
    user?: { login?: string; type?: string };
  };
}

export function parsePullRequestOutcome(
  eventName: string,
  deliveryId: string,
  payload: LearningPayload,
): {
  deliveryId: string;
  jobId: string;
  repositoryId: number;
  repository: string;
  pullRequestNumber: number;
  outcome: "merged" | "closed";
  commitSha?: string | undefined;
} | null {
  if (eventName !== "pull_request" || payload.action !== "closed") return null;
  const repositoryId = payload.repository?.id;
  const repository = payload.repository?.full_name;
  const pullRequestNumber = payload.pull_request?.number;
  const jobId = payload.pull_request?.body?.match(/Diffuin job:\s*`([0-9a-f-]{36})`/i)?.[1];
  if (!repositoryId || !repository || !pullRequestNumber || !jobId) return null;
  return {
    deliveryId,
    jobId,
    repositoryId,
    repository,
    pullRequestNumber,
    outcome: payload.pull_request?.merged ? "merged" : "closed",
    ...(payload.pull_request?.merge_commit_sha ? { commitSha: payload.pull_request.merge_commit_sha } : {}),
  };
}

export function parseMemoryCommand(
  eventName: string,
  deliveryId: string,
  payload: LearningPayload,
  handle: string,
): MemoryCommand | null {
  if ((eventName !== "issue_comment" && eventName !== "pull_request_review_comment") || payload.action !== "created") {
    return null;
  }
  const body = payload.comment?.body;
  const mention = body ? parseMention(body, handle) : null;
  if (!mention) return null;

  const common = commonRequest(eventName, deliveryId, payload, mention.task);
  if (!common) return null;
  const task = mention.task.trim();

  if (/^(?:memories|list memories|what (?:have you|do you) (?:learned|remember))\??$/i.test(task)) {
    return { ...common, memoryAction: "list", evidenceUrl: evidenceUrl(common, eventName) };
  }

  const forget = task.match(/^(?:forget|remove memory)\s+([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\b/i);
  if (forget) {
    return { ...common, memoryAction: "forget", memoryId: forget[1]!.toLowerCase(), evidenceUrl: evidenceUrl(common, eventName) };
  }

  const remember = task.match(/^remember\s+(?:(fact|preference|precedent|warning)\s+)?for\s+(this repository|me|(?:path\s+)?([^:]{1,200}))\s*:\s*(.{3,2000})$/is);
  if (!remember) return null;
  const target = remember[2]!.trim();
  const scope: MemoryScope = /^me$/i.test(target)
    ? "user"
    : /^this repository$/i.test(target)
      ? "repository"
      : "path";
  const rawText = remember[4]!.trim();
  const because = rawText.match(/^(.*?)(?:\s+because\s+)(.{3,1000})$/is);
  const memoryText = (because?.[1] ?? rawText).trim();
  const memoryRationale = because?.[2]?.trim();
  const memoryKind = (remember[1]?.toLowerCase() as MemoryKind | undefined) ?? "preference";
  const pathGlob = scope === "path" ? remember[3]!.trim() : undefined;
  if (!memoryText || (pathGlob && !isSafePathGlob(pathGlob))) return null;

  return {
    ...common,
    memoryAction: "remember",
    memoryScope: scope,
    memoryKind,
    memoryText,
    memoryRationale,
    memoryPathGlob: pathGlob,
    evidenceUrl: evidenceUrl(common, eventName),
  };
}

export function parseFeedbackEvent(
  eventName: string,
  deliveryId: string,
  payload: LearningPayload,
): FeedbackEvent | null {
  if (eventName !== "pull_request_review_comment" || payload.action !== "created") return null;
  const body = payload.comment?.body?.trim() ?? "";
  const signal = classifyFeedback(body);
  const common = commonRequest(eventName, deliveryId, payload, body);
  const externalCommentId = payload.comment?.in_reply_to_id;
  if (!signal || !common || !externalCommentId) return null;
  return {
    ...common,
    externalCommentId,
    signal,
    operation: "add",
    body,
  };
}

function commonRequest(
  eventName: string,
  deliveryId: string,
  payload: LearningPayload,
  task: string,
): WorkRequest | null {
  const repository = payload.repository?.full_name;
  const [owner, repo, extra] = repository?.split("/") ?? [];
  const installationId = payload.installation?.id;
  const repositoryId = payload.repository?.id;
  const issueNumber = payload.issue?.number ?? payload.pull_request?.number;
  const commentId = payload.comment?.id;
  const actor = payload.sender?.login ?? payload.comment?.user?.login;
  const actorType = payload.sender?.type ?? payload.comment?.user?.type;
  if (!repository || !owner || !repo || extra || !installationId || !repositoryId || !issueNumber || !commentId || !actor || actorType === "Bot") {
    return null;
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
    kind: eventName === "pull_request_review_comment" || Boolean(payload.issue?.pull_request) ? "pull_request" : "issue",
    task,
    mode: "answer",
    closeIssueOnMerge: false,
  };
}

function evidenceUrl(request: WorkRequest, eventName: string): string {
  const anchor = eventName === "pull_request_review_comment"
    ? `#discussion_r${request.commentId}`
    : `#issuecomment-${request.commentId}`;
  return `https://github.com/${request.repository}/issues/${request.issueNumber}${anchor}`;
}

function isSafePathGlob(value: string): boolean {
  return !value.startsWith("/") && !value.includes("..") && /^[A-Za-z0-9_.*?/{},@+-]+$/.test(value);
}

function classifyFeedback(value: string): "positive" | "negative" | null {
  if (/\b(?:false positive|not applicable|incorrect|wrong|misread|we (?:do not|don't|never|prefer)|not helpful)\b/i.test(value)) {
    return "negative";
  }
  if (/\b(?:good catch|correct|helpful|useful|thanks|thank you|exactly right)\b/i.test(value)) {
    return "positive";
  }
  return null;
}
