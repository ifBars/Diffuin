import { App, Octokit } from "octokit";
import type {
  GitHubPort,
  GitHubReadSource,
  IssueCommentContext,
  IssueContext,
  PullRequestContext,
  WorkRequest,
} from "./types.js";

export class GitHubClient implements GitHubPort, GitHubReadSource {
  private readonly app: App;
  private readonly publicGitHub = new Octokit();

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

  async readRepository(request: WorkRequest, repository: string): Promise<unknown> {
    const { owner, repo } = splitRepository(repository);
    const { octokit, metadata } = await this.authorizedReadClient(request, owner, repo);
    const response = metadata ?? await octokit.rest.repos.get({ owner, repo });
    return {
      repository: response.data.full_name,
      description: response.data.description,
      visibility: response.data.visibility,
      defaultBranch: response.data.default_branch,
      archived: response.data.archived,
      fork: response.data.fork,
      language: response.data.language,
      updatedAt: response.data.updated_at,
    };
  }

  async readFile(
    request: WorkRequest,
    repository: string,
    path: string,
    ref?: string,
  ): Promise<unknown> {
    const { owner, repo } = splitRepository(repository);
    const { octokit } = await this.authorizedReadClient(request, owner, repo);
    const response = await octokit.rest.repos.getContent({ owner, repo, path, ...(ref ? { ref } : {}) });
    if (Array.isArray(response.data)) {
      return {
        repository,
        path,
        ref: ref ?? null,
        entries: response.data.slice(0, 200).map((entry) => ({
          name: entry.name,
          path: entry.path,
          type: entry.type,
          size: entry.size,
          sha: entry.sha,
        })),
      };
    }
    if (response.data.type !== "file" || !("content" in response.data)) {
      return { repository, path, ref: ref ?? null, type: response.data.type, sha: response.data.sha };
    }
    if (response.data.size > 100_000) {
      throw new Error(`File is ${response.data.size} bytes; the read-only file limit is 100000 bytes`);
    }
    const content = Buffer.from(response.data.content, "base64").toString("utf8");
    if (content.includes("\0") || replacementCharacterRatio(content) > 0.01) {
      throw new Error("Binary files are not available through the GitHub read broker");
    }
    return {
      repository,
      path: response.data.path,
      ref: ref ?? null,
      sha: response.data.sha,
      size: response.data.size,
      content,
    };
  }

  async searchCode(request: WorkRequest, repository: string, query: string): Promise<unknown> {
    const { owner, repo } = splitRepository(repository);
    const { octokit } = await this.authorizedReadClient(request, owner, repo);
    const unscopedQuery = query.replace(/\b(?:repo|org|user):\S+/gi, " ").trim();
    if (unscopedQuery.length < 2) throw new Error("Code search query is empty after removing scope qualifiers");
    const response = await octokit.rest.search.code({
      q: `${unscopedQuery} repo:${owner}/${repo}`,
      per_page: 20,
    });
    return {
      repository,
      query: unscopedQuery,
      totalCount: response.data.total_count,
      results: response.data.items
        .filter((item) => item.repository.full_name.toLowerCase() === repository.toLowerCase())
        .slice(0, 20)
        .map((item) => ({ path: item.path, sha: item.sha, url: item.html_url })),
    };
  }

  async readIssue(request: WorkRequest, repository: string, number: number): Promise<unknown> {
    const { owner, repo } = splitRepository(repository);
    const { octokit } = await this.authorizedReadClient(request, owner, repo);
    const [issue, comments] = await Promise.all([
      octokit.rest.issues.get({ owner, repo, issue_number: number }),
      octokit.rest.issues.listComments({ owner, repo, issue_number: number, per_page: 20, sort: "created", direction: "desc" }),
    ]);
    return {
      repository,
      number,
      title: issue.data.title,
      state: issue.data.state,
      author: issue.data.user?.login ?? null,
      labels: issue.data.labels.map((label) => typeof label === "string" ? label : label.name),
      body: compactReadValue(issue.data.body ?? "", 40_000),
      comments: comments.data.reverse().map((comment) => ({
        author: comment.user?.login ?? null,
        createdAt: comment.created_at,
        body: compactReadValue(comment.body ?? "", 12_000),
      })),
    };
  }

  async readPullRequest(request: WorkRequest, repository: string, number: number): Promise<unknown> {
    const { owner, repo } = splitRepository(repository);
    const { octokit } = await this.authorizedReadClient(request, owner, repo);
    const [pull, files, comments] = await Promise.all([
      octokit.rest.pulls.get({ owner, repo, pull_number: number }),
      octokit.rest.pulls.listFiles({ owner, repo, pull_number: number, per_page: 100 }),
      octokit.rest.issues.listComments({ owner, repo, issue_number: number, per_page: 20, sort: "created", direction: "desc" }),
    ]);
    return {
      repository,
      number,
      title: pull.data.title,
      state: pull.data.state,
      draft: pull.data.draft,
      author: pull.data.user?.login ?? null,
      base: `${pull.data.base.repo.full_name}:${pull.data.base.ref}`,
      head: `${pull.data.head.repo?.full_name ?? "unknown"}:${pull.data.head.ref}`,
      additions: pull.data.additions,
      deletions: pull.data.deletions,
      changedFiles: pull.data.changed_files,
      body: compactReadValue(pull.data.body ?? "", 40_000),
      files: files.data.map((file) => ({
        path: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: compactReadValue(file.patch ?? "", 20_000),
      })),
      comments: comments.data.reverse().map((comment) => ({
        author: comment.user?.login ?? null,
        createdAt: comment.created_at,
        body: compactReadValue(comment.body ?? "", 12_000),
      })),
    };
  }

  private async authorizedReadClient(request: WorkRequest, owner: string, repo: string) {
    const installation = await this.installation(request);
    let octokit: typeof installation | Octokit = installation;
    let metadata;
    try {
      metadata = await installation.rest.repos.get({ owner, repo });
    } catch (error) {
      if (!isNotFoundOrForbidden(error)) throw error;
      metadata = await this.publicGitHub.rest.repos.get({ owner, repo });
      octokit = this.publicGitHub;
    }
    if (metadata.data.private) {
      try {
        const permission = await installation.rest.repos.getCollaboratorPermissionLevel({
          owner,
          repo,
          username: request.actor,
        });
        if (permission.data.permission === "none") {
          throw new Error("actor has no repository permission");
        }
      } catch {
        throw new Error(`Private repository ${owner}/${repo} is not readable by @${request.actor} through this installation`);
      }
    }
    return { octokit, metadata };
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

function splitRepository(repository: string): { owner: string; repo: string } {
  const match = repository.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw new Error(`Invalid GitHub repository: ${repository}`);
  return { owner: match[1]!, repo: match[2]! };
}

function isNotFoundOrForbidden(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  return error.status === 403 || error.status === 404;
}

function replacementCharacterRatio(value: string): number {
  if (!value.length) return 0;
  return (value.match(/\uFFFD/g)?.length ?? 0) / value.length;
}

function compactReadValue(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n\n[Content truncated by Diffuin.]`;
}

function compactContext(body: string): string {
  const limit = 12_000;
  if (body.length <= limit) return body;
  const boundary = body.lastIndexOf("\n\n", limit);
  const end = boundary >= 8_000 ? boundary : limit;
  return `${body.slice(0, end)}\n\n[Earlier comment shortened for prompt context.]`;
}
