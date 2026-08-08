import { App } from "octokit";
import type { GitHubPort, IssueCommentContext, IssueContext, PullRequestContext, WorkRequest } from "./types.js";

export class GitHubClient implements GitHubPort {
  private readonly app: App;

  constructor(appId: number, privateKey: string, webhookSecret: string) {
    this.app = new App({ appId, privateKey, webhooks: { secret: webhookSecret } });
  }

  private installation(request: WorkRequest) {
    return this.app.getInstallationOctokit(request.installationId);
  }

  async getActorPermission(request: WorkRequest): Promise<string> {
    const octokit = await this.installation(request);
    const response = await octokit.rest.repos.getCollaboratorPermissionLevel({
      owner: request.owner,
      repo: request.repo,
      username: request.actor,
    });
    return response.data.permission;
  }

  async addReaction(request: WorkRequest, reaction: "+1" | "eyes" | "rocket" | "confused"): Promise<void> {
    const octokit = await this.installation(request);
    await octokit.rest.reactions.createForIssueComment({
      owner: request.owner,
      repo: request.repo,
      comment_id: request.commentId,
      content: reaction,
    });
  }

  async comment(request: WorkRequest, body: string): Promise<number> {
    const octokit = await this.installation(request);
    const response = await octokit.rest.issues.createComment({
      owner: request.owner,
      repo: request.repo,
      issue_number: request.issueNumber,
      body,
    });
    return response.data.id;
  }

  async updateComment(request: WorkRequest, commentId: number, body: string): Promise<void> {
    const octokit = await this.installation(request);
    await octokit.rest.issues.updateComment({
      owner: request.owner,
      repo: request.repo,
      comment_id: commentId,
      body,
    });
  }

  async reviewPullRequest(
    request: WorkRequest,
    body: string,
    comments: Array<{ path: string; line: number; body: string }>,
  ): Promise<void> {
    const octokit = await this.installation(request);
    await octokit.rest.pulls.createReview({
      owner: request.owner,
      repo: request.repo,
      pull_number: request.issueNumber,
      event: "COMMENT",
      body,
      comments: comments.map((comment) => ({ ...comment, side: "RIGHT" as const })),
    });
  }

  async getDefaultBranch(request: WorkRequest): Promise<string> {
    const octokit = await this.installation(request);
    const response = await octokit.rest.repos.get({ owner: request.owner, repo: request.repo });
    return response.data.default_branch;
  }

  async getIssue(request: WorkRequest): Promise<IssueContext> {
    const octokit = await this.installation(request);
    const response = await octokit.rest.issues.get({
      owner: request.owner,
      repo: request.repo,
      issue_number: request.issueNumber,
    });
    return {
      title: response.data.title,
      body: response.data.body ?? null,
      comments: await this.getConversation(request),
    };
  }

  async getPullRequest(request: WorkRequest): Promise<PullRequestContext> {
    const octokit = await this.installation(request);
    const response = await octokit.rest.pulls.get({
      owner: request.owner,
      repo: request.repo,
      pull_number: request.issueNumber,
    });
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner: request.owner,
      repo: request.repo,
      pull_number: request.issueNumber,
      per_page: 100,
    }, (page) => page.data.map((file) => file.filename));
    return {
      baseBranch: response.data.base.ref,
      headBranch: response.data.head.ref,
      headSha: response.data.head.sha,
      headRepository: response.data.head.repo?.full_name ?? "",
      title: response.data.title,
      body: response.data.body,
      additions: response.data.additions,
      deletions: response.data.deletions,
      changedFiles: response.data.changed_files,
      files,
      comments: await this.getConversation(request),
    };
  }

  async updateIssue(request: WorkRequest, input: { title: string; body: string }): Promise<void> {
    const octokit = await this.installation(request);
    await octokit.rest.issues.update({
      owner: request.owner,
      repo: request.repo,
      issue_number: request.issueNumber,
      title: input.title,
      body: input.body,
    });
  }

  async getInstallationToken(request: WorkRequest): Promise<string> {
    const authentication = await this.app.octokit.auth({
      type: "installation",
      installationId: request.installationId,
      repositoryIds: [request.repositoryId],
    });
    if (!authentication || typeof authentication !== "object" || !("token" in authentication)) {
      throw new Error("GitHub did not return an installation token");
    }
    return String(authentication.token);
  }

  async createPullRequest(
    request: WorkRequest,
    input: { head: string; base: string; title: string; body: string },
  ): Promise<{ number: number; url: string }> {
    const octokit = await this.installation(request);
    const response = await octokit.rest.pulls.create({
      owner: request.owner,
      repo: request.repo,
      head: input.head,
      base: input.base,
      title: input.title,
      body: input.body,
    });
    return { number: response.data.number, url: response.data.html_url };
  }

  private async getConversation(request: WorkRequest): Promise<IssueCommentContext[]> {
    const octokit = await this.installation(request);
    const comments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner: request.owner,
      repo: request.repo,
      issue_number: request.issueNumber,
      per_page: 100,
    }, (page) => page.data.map((comment) => ({
      id: comment.id,
      author: comment.user?.login ?? "unknown",
      body: compactContext(comment.body ?? ""),
    })));
    return comments.slice(-8);
  }
}

function compactContext(body: string): string {
  const limit = 12_000;
  if (body.length <= limit) return body;
  const boundary = body.lastIndexOf("\n\n", limit);
  const end = boundary >= 8_000 ? boundary : limit;
  return `${body.slice(0, end)}\n\n[Earlier comment shortened for prompt context.]`;
}
