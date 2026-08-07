import { App } from "octokit";
import type { GitHubPort, IssueContext, PullRequestContext, WorkRequest } from "./types.js";

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

  async comment(request: WorkRequest, body: string): Promise<void> {
    const octokit = await this.installation(request);
    await octokit.rest.issues.createComment({
      owner: request.owner,
      repo: request.repo,
      issue_number: request.issueNumber,
      body,
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
    return { title: response.data.title, body: response.data.body ?? null };
  }

  async getPullRequest(request: WorkRequest): Promise<PullRequestContext> {
    const octokit = await this.installation(request);
    const response = await octokit.rest.pulls.get({
      owner: request.owner,
      repo: request.repo,
      pull_number: request.issueNumber,
    });
    return {
      baseBranch: response.data.base.ref,
      headBranch: response.data.head.ref,
      headSha: response.data.head.sha,
      headRepository: response.data.head.repo?.full_name ?? "",
      title: response.data.title,
      body: response.data.body,
    };
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
}
