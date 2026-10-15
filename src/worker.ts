import { artifactOutputSchema, parseArtifact, renderArtifact, renderInlineFallback } from "./artifact.js";
import type { Config } from "./config.js";
import { buildPrompt } from "./prompt.js";
import { routeExecution } from "./routing.js";
import type { RoutingAdvisorPort } from "./routing-advisor.js";
import { assertNoSecrets } from "./secrets.js";
import type {
  AssetRipperReadBrokerPort,
  AssetRipperReadSession,
  AgentProfilePort,
  CodexPort,
  GitHubPort,
  GitHubReadBrokerPort,
  GitHubReadSession,
  Job,
  PullRequestContext,
  PullRequestReviewContext,
} from "./types.js";
import { GitWorkspace } from "./git.js";
import { assertPublicationAllowed, requestsPublication } from "./intent.js";
import { JobStore } from "./store.js";
import { canWrite } from "./mention.js";
import { canAutomaticallyAddressReview, isDiffuinOwnedPullRequest } from "./pull-request.js";

export class Worker {
  private stopped = false;

  constructor(
    private readonly config: Config,
    private readonly store: JobStore,
    private readonly github: GitHubPort,
    private readonly codex: CodexPort,
    private readonly workspaces: GitWorkspace,
    private readonly profile: AgentProfilePort,
    private readonly githubReadBroker: GitHubReadBrokerPort,
    private readonly assetRipperReadBroker: AssetRipperReadBrokerPort,
    private readonly routingAdvisor?: RoutingAdvisorPort,
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
    let publishedCommit: string | null = null;
    const startedAt = Date.now();
    try {
      const pullRequest = job.kind === "pull_request" ? await this.github.getPullRequest(job) : null;
      const review = job.commentKind === "review" ? await this.loadRequestedReview(job, pullRequest) : undefined;
      const issue = pullRequest ?? await this.github.getIssue(job);
      await this.syncFindingFeedback(job);
      const baselineRoute = routeExecution(job, issue, pullRequest, this.config);
      const route = await this.advisedRoute(job, issue, pullRequest, baselineRoute);
      statusCommentId = await this.github.comment(
        job,
        `I'm ${presentParticiple(route.mode)} this ${job.kind === "pull_request" ? "pull request" : "issue"}.\n\n` +
        `<sub>Model: \`${route.model}\` · Reasoning: \`${route.reasoningEffort}\` (${route.reason})</sub>`,
      );

      const defaultBranch = await this.github.getDefaultBranch(job);
      let targetBranch = targetBranchFor(job, pullRequest, defaultBranch);
      if (!pullRequest && targetBranch !== defaultBranch && this.github.hasBranch &&
          !await this.github.hasBranch(job, targetBranch)) {
        targetBranch = defaultBranch;
      }
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
      const sourceSha = await this.workspaces.currentRevision(repository.path);
      const guidanceReference = repository.comparisonReference ?? "HEAD";
      const repositoryGuidance = await this.workspaces.readRepositoryGuidance(
        repository.path,
        guidanceReference,
        token,
      );
      const profile = await this.profile.prepare(job);
      githubReadSession = this.githubReadBroker.openSession(job, issue, repositoryGuidance, profile.referenceSnapshots);
      const projectMemories = this.store.listApplicableMemories?.(
        job,
        pullRequest?.files ?? [],
        route.mode !== "review",
      ) ?? [];
      assetRipperReadSession = await this.assetRipperReadBroker.openSession(profile.assetRipperPath);
      const result = await this.codex.run(
        repository.path,
        buildPrompt(
          job,
          issue,
          pullRequest,
          profile,
          repository.comparisonReference,
          route,
          githubReadSession.repositories,
          projectMemories,
          review,
          targetBranch,
        ),
        {
          model: route.model,
          reasoningEffort: route.reasoningEffort,
          outputSchema: artifactOutputSchema,
          readRoots: [...profile.readRoots],
          githubReadSession,
          ...(assetRipperReadSession ? { assetRipperReadSession } : {}),
        },
      );
      assertNoSecrets(result.finalResponse);
      const artifact = parseArtifact(result.finalResponse);
      this.store.saveArtifact?.(job, artifact, sourceSha, statusCommentId, {
        provider: result.provider ?? "codex",
        model: route.model,
        reasoningEffort: route.reasoningEffort,
        profileId: profile.id,
        threadId: result.threadId,
      });
      const publishChanges = requestsPublication(artifact);
      const rendered = renderArtifact(artifact, route, {
        threadId: result.threadId,
        ...(result.provider ? { provider: result.provider } : {}),
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
        includeImplementationAction:
          job.kind === "issue" && !publishChanges &&
          (artifact.offerImplementation ?? (artifact.intent === "investigate" || artifact.intent === "plan")),
      });
      assertNoSecrets(rendered.body);

      let issueUpdateNotice = "";
      if (job.kind === "issue" && !publishChanges && artifact.issuePolish.needed) {
        const title = artifact.issuePolish.title.trim();
        const body = artifact.issuePolish.body.trim();
        if (!title || !body) {
          throw new Error("Agent requested an issue polish without a complete replacement title and body");
        }
        assertNoSecrets(`${title}\n${body}`);
        await this.github.updateIssue(job, { title, body });
        issueUpdateNotice = `> I polished the issue description: ${artifact.issuePolish.reason}\n\n`;
      }

      const hasChanges = await this.workspaces.hasChanges(repository.path);
      if (review) {
        const current = await this.github.getPullRequest(job);
        await this.loadRequestedReview(job, current);
        if (current.headSha !== pullRequest?.headSha || current.headBranch !== pullRequest.headBranch) {
          throw new Error("The PR head changed during review remediation; refusing to publish stale results. Submit a new review or request another implementation run.");
        }
      }
      if (hasChanges && !publishChanges) {
        if (job.mode !== "auto" && job.mode !== "implement") assertPublicationAllowed(job.mode, artifact);
        const patch = await this.workspaces.readPatch(repository.path);
        assertNoSecrets(patch);
        this.store.saveUnpublishedPatch(job.id, patch);
      }
      if (!hasChanges || !publishChanges) {
        const noChangesNotice = hasChanges
          ? `No changes were published. The unpublished patch is retained with Diffuin run \`${job.id}\`.\n\n`
          : review ? "I made no repository changes.\n\n"
          : publishChanges ? "No repository changes were produced, so no commit or pull request was created.\n\n" : "";
        let body = `${noChangesNotice}${issueUpdateNotice}${rendered.body}`;
        if (job.kind === "pull_request" && !publishChanges && rendered.inlineComments.length) {
          try {
            const externalCommentIds = await this.github.reviewPullRequest(job, "", rendered.inlineComments);
            this.store.recordDeliveredFindings?.(job.id, artifact, externalCommentIds);
          } catch {
            body += renderInlineFallback(rendered.inlineComments);
          }
        }
        await this.replaceStatus(job, statusCommentId, body);
        if (review) await this.replyToRequestedReview(job, review, body);
        this.store.finish(job.id, "succeeded");
        return;
      }

      assertPublicationAllowed(job.mode, artifact);
      if (!this.config.allowedRepositories.has(job.repository.toLowerCase()) ||
          !canWrite(await this.github.getActorPermission(job))) {
        throw new Error("Publication requires an allowlisted repository and a write-authorized actor");
      }

      const patch = await this.workspaces.readPatch(repository.path);
      assertNoSecrets(patch);
      const updatesExistingPullRequest = isDiffuinOwnedPullRequest(job, pullRequest);
      const commitSha = await this.workspaces.commitAndPush(
        repository,
        token,
        `chore(diffuin): address #${job.issueNumber}`,
        updatesExistingPullRequest ? pullRequest.headBranch : repository.branch,
      );
      publishedCommit = commitSha;
      if (updatesExistingPullRequest) {
        const body = `I updated this pull request with commit [\`${commitSha.slice(0, 7)}\`](https://github.com/${job.repository}/commit/${commitSha}).\n\n${rendered.body}`;
        await this.github.addReaction(job, "rocket");
        await this.replaceStatus(
          job,
          statusCommentId,
          body,
        );
        if (review) await this.replyToRequestedReview(job, review, body);
        this.store.finish(job.id, "succeeded");
        return;
      }
      const created = await this.github.createPullRequest(job, {
        head: repository.branch,
        base: targetBranch,
        title: pullRequestTitle(artifact.pullRequestTitle, job.task),
        body: buildPullRequestBody(job, rendered.body, commitSha, artifact.closesIssue || job.closeIssueOnMerge),
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
        `${publishedCommit ? `I pushed commit [\`${publishedCommit.slice(0, 7)}\`](https://github.com/${job.repository}/commit/${publishedCommit}), but couldn't complete delivery of the result.` : "I couldn't complete this request."}\n\n\`${escapeInline(message)}\``,
      ).catch(() => undefined);
    } finally {
      githubReadSession?.close();
      assetRipperReadSession?.close();
      if (workspacePath) {
        await this.workspaces.cleanup(workspacePath).catch(() => undefined);
      }
    }
  }

  private async loadRequestedReview(job: Job, pullRequest: PullRequestContext | null): Promise<PullRequestReviewContext> {
    if (!this.config.allowedRepositories.has(job.repository.toLowerCase()) ||
        !canWrite(await this.github.getActorPermission(job)) ||
        !canAutomaticallyAddressReview(job, pullRequest, this.config.handle)) {
      throw new Error("Automatic review remediation requires an authorized actor and an open Diffuin-owned pull request");
    }
    const review = await this.github.getPullRequestReview?.(job);
    if (!review || review.id !== job.commentId || review.actor.toLowerCase() !== job.actor.toLowerCase() ||
        review.state.toUpperCase() !== "CHANGES_REQUESTED") {
      throw new Error("The requested review is unavailable, dismissed, or no longer requests changes");
    }
    return review;
  }

  private async replyToRequestedReview(job: Job, review: PullRequestReviewContext, body: string): Promise<void> {
    const roots = new Set(review.comments.map((comment) => comment.replyTo ?? comment.id));
    for (const commentId of roots) {
      if (!this.github.replyToReviewComment) throw new Error("Review thread replies are unavailable");
      await this.github.replyToReviewComment(job, commentId, body);
    }
  }

  private async advisedRoute(
    job: Job,
    issue: Parameters<RoutingAdvisorPort["advise"]>[1],
    pullRequest: PullRequestContext | null,
    baseline: Parameters<RoutingAdvisorPort["advise"]>[3],
  ) {
    if (!this.routingAdvisor) {
      return baseline;
    }
    try {
      return await this.routingAdvisor.advise(job, issue, pullRequest, baseline) ?? baseline;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Routing advisor failed; using deterministic route: ${message.slice(0, 500)}`);
      return baseline;
    }
  }

  private async syncFindingFeedback(job: Job): Promise<void> {
    if (!this.github.listReviewCommentReactions) return;
    const commentIds = this.store.findingsForFeedbackSync?.(job.repositoryId) ?? [];
    for (const commentId of commentIds) {
      try {
        const reactions = await this.github.listReviewCommentReactions(job, commentId);
        this.store.replaceFindingReactions?.(commentId, reactions);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Could not refresh reactions for review comment ${commentId}: ${message.slice(0, 300)}`);
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
  const match = task.match(/\b(?:against|into|target(?:ing)?)\s+(?:the\s+)?(?:(?:latest|current)\s+)?(?:branch\s+)?[`'"]?([A-Za-z0-9][A-Za-z0-9._/-]{0,100})/i);
  const branch = match?.[1];
  if (!branch || /^(?:latest|current|default|new|existing|branch)$/i.test(branch) ||
      branch.includes("..") || branch.endsWith("/") || branch.endsWith(".lock")) {
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
    case "auto": return "handling";
    case "review": return "reviewing";
    case "investigate": return "investigating";
    case "plan": return "planning";
    case "implement": return "implementing";
    default: return "answering";
  }
}
