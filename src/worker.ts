import type { Config } from "./config.js";
import { buildPrompt } from "./prompt.js";
import { assertNoSecrets } from "./secrets.js";
import type { CodexPort, GitHubPort, Job, PullRequestContext } from "./types.js";
import { GitWorkspace } from "./git.js";
import { JobStore } from "./store.js";

export class Worker {
  private stopped = false;

  constructor(
    private readonly config: Config,
    private readonly store: JobStore,
    private readonly github: GitHubPort,
    private readonly codex: CodexPort,
    private readonly workspaces: GitWorkspace,
  ) {}

  async start(): Promise<void> {
    this.store.recoverInterrupted();
    while (!this.stopped) {
      const job = this.store.claimNext();
      if (!job) {
        await delay(this.config.jobPollIntervalMs);
        continue;
      }
      await this.process(job);
    }
  }

  stop(): void {
    this.stopped = true;
  }

  async process(job: Job): Promise<void> {
    let workspacePath: string | null = null;
    try {
      const pullRequest = job.kind === "pull_request" ? await this.github.getPullRequest(job) : null;
      const defaultBranch = await this.github.getDefaultBranch(job);
      const sourceRef = pullRequest?.headSha ?? defaultBranch;
      const token = await this.github.getInstallationToken(job);
      const repository = await this.workspaces.prepare({
        jobId: job.id,
        owner: job.owner,
        repo: job.repo,
        sourceRef,
        token,
        issueNumber: job.issueNumber,
      });
      workspacePath = repository.path;

      const result = await this.codex.run(repository.path, buildPrompt(job, pullRequest));
      assertNoSecrets(result.finalResponse);
      if (!(await this.workspaces.hasChanges(repository.path))) {
        await this.github.comment(job, `Diffuin finished without making repository changes.\n\n${truncate(result.finalResponse)}`);
        this.store.finish(job.id, "succeeded");
        return;
      }

      const patch = await this.workspaces.readPatch(repository.path);
      assertNoSecrets(patch);
      const commitSha = await this.workspaces.commitAndPush(
        repository,
        token,
        `chore(diffuin): address #${job.issueNumber}`,
      );
      const targetBranch = targetBranchFor(job, pullRequest, defaultBranch);
      const created = await this.github.createPullRequest(job, {
        head: repository.branch,
        base: targetBranch,
        title: `Diffuin: ${truncateTitle(job.task)}`,
        body: buildPullRequestBody(job, result.finalResponse, result.threadId, commitSha),
      });
      await this.github.addReaction(job, "rocket");
      await this.github.comment(job, `Diffuin opened #${created.number}: ${created.url}`);
      this.store.finish(job.id, "succeeded");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.finish(job.id, "failed", message);
      await this.github.addReaction(job, "confused").catch(() => undefined);
      await this.github.comment(job, `Diffuin could not complete this request.\n\n\`${escapeInline(message)}\``).catch(() => undefined);
    } finally {
      if (workspacePath) {
        await this.workspaces.cleanup(workspacePath).catch(() => undefined);
      }
    }
  }
}

function targetBranchFor(job: Job, pullRequest: PullRequestContext | null, defaultBranch: string): string {
  if (!pullRequest) {
    return defaultBranch;
  }
  return pullRequest.headRepository.toLowerCase() === job.repository.toLowerCase()
    ? pullRequest.headBranch
    : pullRequest.baseBranch;
}

function buildPullRequestBody(job: Job, response: string, threadId: string, commitSha: string): string {
  return `Requested by @${job.actor} in #${job.issueNumber}.

${truncate(response)}

---
Diffuin job: \`${job.id}\`  
Codex thread: \`${threadId}\`  
Commit: \`${commitSha}\``;
}

function truncate(value: string, length = 5000): string {
  return value.length <= length ? value : `${value.slice(0, length)}\n\n…truncated`;
}

function truncateTitle(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length <= 72 ? singleLine : `${singleLine.slice(0, 71)}…`;
}

function escapeInline(value: string): string {
  return value.replace(/`/g, "'").slice(0, 1000);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
