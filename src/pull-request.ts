import type { PullRequestContext, WorkRequest } from "./types.js";

export function isDiffuinOwnedPullRequest(
  request: WorkRequest,
  pullRequest: PullRequestContext | null,
): pullRequest is PullRequestContext {
  return request.kind === "pull_request" && pullRequest !== null &&
    pullRequest.headRepository.toLowerCase() === request.repository.toLowerCase() &&
    /^diffuin\/\d+-[0-9a-f]{8}$/.test(pullRequest.headBranch) &&
    (pullRequest.body?.includes("Diffuin job: `") ?? false);
}

export function canAutomaticallyAddressReview(
  request: WorkRequest,
  pullRequest: PullRequestContext | null,
  handle: string,
): pullRequest is PullRequestContext {
  return isDiffuinOwnedPullRequest(request, pullRequest) &&
    pullRequest.state === "open" &&
    pullRequest.author?.toLowerCase() === `${handle.toLowerCase()}[bot]`;
}
