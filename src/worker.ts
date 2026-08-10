import { artifactOutputSchema, parseArtifact, renderArtifact, renderInlineFallback } from "./artifact.js";
import type { Config } from "./config.js";
import { buildPrompt } from "./prompt.js";
import { routeExecution } from "./routing.js";
import { assertNoSecrets } from "./secrets.js";
import type {
  AssetRipperReadBrokerPort,
  AssetRipperReadSession,
  CodexPort,
  GitHubPort,
  GitHubReadBrokerPort,
  GitHubReadSession,
  Job,
  PullRequestContext,
} from "./types.js";
import { GitWorkspace } from "./git.js";
import { JobStore } from "./store.js";
import { ScheduleOneReferenceWorkspace } from "./references.js";

export class Worker {
  private stopped = false;

  constructor(
    private readonly config: Config,
    private readonly store: JobStore,
    private readonly github: GitHubPort,
    private readonly codex: CodexPort,
    private readonly workspaces: GitWorkspace,
    private readonly references: ScheduleOneReferenceWorkspace,
    private readonly githubReadBroker: GitHubReadBrokerPort,
    private readonly assetRipperReadBroker: AssetRipperReadBrokerPort,
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
    let githubReadSession: GitHubReadSession | null = null;
    let assetRipperReadSession: AssetRipperReadSession | undefined;
    let statusCommentId: number | null = null;
    const startedAt = Date.now();
    try {
      const pullRequest = job.kind === "pull_request" ? await this.github.getPullRequest(job) : null;
      const issue = pullRequest ?? await this.github.getIssue(job);
      githubReadSession = this.githubReadBroker.openSession(job, issue);
      const route = routeExecution(job, issue, pullRequest, this.config);
      statusCommentId = await this.github.comment(
        job,
        `I'm ${presentParticiple(route.mode)} this ${job.kind === "pull_request" ? "pull request" : "issue"}.\n\n` +
        `<sub>Model: \`${route.model}\` · Reasoning: \`${route.reasoningEffort}\` (${route.reason})</sub>`,
      );

      const defaultBranch = await this.github.getDefaultBranch(job);
      const targetBranch = targetBranchFor(job, pullRequest, defaultBranch);
      const sourceRef = pullRequest?.headSha ?? targetBranch;
      const token = await this.github.getInstallationToken(job);
      const repository = await this.workspaces.prepare({
        jobId: job.id,
        owner: job.owner,
        repo: job.repo,
        sourceRef,
        comparisonRef: pullRequest?.baseBranch,
        token,
        issueNumber: job.issueNumber,
      });
      workspacePath = repository.path;

      const references = await this.references.prepare();
      assetRipperReadSession = await this.assetRipperReadBroker.openSession(references.assetRipperPath);
      const result = await this.codex.run(
        repository.path,
        buildPrompt(
          job,
          issue,
          pullRequest,
          references,
          repository.comparisonReference,
          route,
          githubReadSession.repositories,
        ),
        {
          model: route.model,
          reasoningEffort: route.reasoningEffort,
          outputSchema: artifactOutputSchema,
          githubReadSession,
          ...(assetRipperReadSession ? { assetRipperReadSession } : {}),
        },
      );
      assertNoSecrets(result.finalResponse);
      const artifact = parseArtifact(result.finalResponse);
      const expectedKind = route.mode === "review" ? "review" : route.mode === "plan" ? "plan" : "response";
      if (artifact.kind !== expectedKind) {
        throw new Error(`Codex returned ${artifact.kind} output for a ${route.mode} request`);
      }
      const rendered = renderArtifact(artifact, route, {
        threadId: result.threadId,
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      });
      assertNoSecrets(rendered.body);

      let issueUpdateNotice = "";
      if (job.kind === "issue" && route.mode !== "implement" && artifact.issuePolish.needed) {
        const title = artifact.issuePolish.title.trim();
        const body = artifact.issuePolish.body.trim();
        if (!title || !body) {
          throw new Error("Codex requested an issue polish without a complete replacement title and body");
        }
        assertNoSecrets(`${title}\n${body}`);
        await this.github.updateIssue(job, { title, body });
        issueUpdateNotice = `> I polished the issue description: ${artifact.issuePolish.reason}\n\n`;
      }

      const hasChanges = await this.workspaces.hasChanges(repository.path);
      if (!hasChanges) {
        if (route.mode === "implement") {
          throw new Error("Implementation was requested, but Codex produced no repository changes; no pull request was opened");
        }
        let body = `${issueUpdateNotice}${rendered.body}`;
        if (job.kind === "pull_request" && route.mode === "review" && rendered.inlineComments.length) {
          try {
            await this.github.reviewPullRequest(job, "", rendered.inlineComments);
          } catch {
            body += renderInlineFallback(rendered.inlineComments);
          }
        }
        await this.replaceStatus(job, statusCommentId, body);
        this.store.finish(job.id, "succeeded");
        return;
      }

      if (route.mode !== "implement") {
        throw new Error(`Codex modified files during a read-only ${route.mode} request; refusing to publish the patch`);
      }

      const patch = await this.workspaces.readPatch(repository.path);
      assertNoSecrets(patch);
      const commitSha = await this.workspaces.commitAndPush(
        repository,
        token,
        `chore(diffuin): address #${job.issueNumber}`,
      );
      const created = await this.github.createPullRequest(job, {
        head: repository.branch,
        base: targetBranch,
        title: pullRequestTitle(artifact.pullRequestTitle, job.task),
        body: buildPullRequestBody(job, rendered.body, commitSha, artifact.closesIssue),
      });
      await this.github.addReaction(job, "rocket");
      await this.replaceStatus(job, statusCommentId, `I opened ${created.url}`);
      this.store.finish(job.id, "succeeded");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.finish(job.id, "failed", message);
      await this.github.addReaction(job, "confused").catch(() => undefined);
      await this.replaceStatus(
        job,
        statusCommentId,
        `I couldn't complete this request.\n\n\`${escapeInline(message)}\``,
      ).catch(() => undefined);
    } finally {
      githubReadSession?.close();
      assetRipperReadSession?.close();
      if (workspacePath) {
        await this.workspaces.cleanup(workspacePath).catch(() => undefined);
      }
    }
  }

  private async replaceStatus(job: Job, commentId: number | null, body: string): Promise<void> {
    if (commentId) {
      await this.github.updateComment(job, commentId, body);
    } else {
      await this.github.comment(job, body);
    }
  }
}

function targetBranchFor(job: Job, pullRequest: PullRequestContext | null, defaultBranch: string): string {
  if (!pullRequest) {
    return requestedTargetBranch(job.task) ?? defaultBranch;
  }
  return pullRequest.headRepository.toLowerCase() === job.repository.toLowerCase()
    ? pullRequest.headBranch
    : pullRequest.baseBranch;
}

function requestedTargetBranch(task: string): string | null {
  const match = task.match(/\b(?:against|into|target(?:ing)?)\s+(?:the\s+)?(?:branch\s+)?[`'"]?([A-Za-z0-9][A-Za-z0-9._/-]{0,100})/i);
  const branch = match?.[1];
  if (!branch || branch.includes("..") || branch.endsWith("/") || branch.endsWith(".lock")) {
    return null;
  }
  return branch;
}

function buildPullRequestBody(job: Job, response: string, commitSha: string, closesIssue: boolean): string {
  const closingReference = job.kind === "issue" && closesIssue ? `\n\nCloses #${job.issueNumber}` : "";
  return `Requested by @${job.actor} in #${job.issueNumber}.

${response}${closingReference}

---
Diffuin job: \`${job.id}\`  
Commit: \`${commitSha}\``;
}

function truncateTitle(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length <= 72 ? singleLine : `${singleLine.slice(0, 71)}…`;
}

function pullRequestTitle(generatedTitle: string, fallbackTask: string): string {
  const title = generatedTitle.replace(/\s+/g, " ").replace(/[`#]/g, "").trim();
  if (title.length >= 8 && title.length <= 120) return title;
  return `Diffuin: ${truncateTitle(fallbackTask)}`;
}

function escapeInline(value: string): string {
  return value.replace(/`/g, "'").slice(0, 1000);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function presentParticiple(mode: string): string {
  switch (mode) {
    case "review": return "reviewing";
    case "investigate": return "investigating";
    case "plan": return "planning";
    case "implement": return "implementing";
    default: return "answering";
  }
}
