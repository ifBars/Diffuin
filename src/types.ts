export type TriggerKind = "issue" | "pull_request";
export type TaskMode = "auto" | "review" | "plan" | "implement" | "answer";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface MentionCommand {
  task: string;
  mode: TaskMode;
  requestedModel?: string | undefined;
  requestedReasoningEffort?: ReasoningEffort | undefined;
  error?: string | undefined;
}

export interface WorkRequest {
  deliveryId: string;
  installationId: number;
  repositoryId: number;
  repository: string;
  owner: string;
  repo: string;
  issueNumber: number;
  commentId: number;
  actor: string;
  kind: TriggerKind;
  task: string;
  mode: TaskMode;
  requestedModel?: string | undefined;
  requestedReasoningEffort?: ReasoningEffort | undefined;
  commandError?: string | undefined;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface Job extends WorkRequest {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface IssueContext {
  title: string;
  body: string | null;
}

export interface PullRequestContext extends IssueContext {
  baseBranch: string;
  headBranch: string;
  headSha: string;
  headRepository: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: string[];
}

export interface ScheduleOneReferences {
  skillPath: string;
  regularSourcePath?: string | undefined;
  betaSourcePath?: string | undefined;
  assetRipperPath?: string | undefined;
  warnings: string[];
}

export interface GitHubPort {
  getActorPermission(request: WorkRequest): Promise<string>;
  addReaction(request: WorkRequest, reaction: "+1" | "eyes" | "rocket" | "confused"): Promise<void>;
  comment(request: WorkRequest, body: string): Promise<number>;
  updateComment(request: WorkRequest, commentId: number, body: string): Promise<void>;
  reviewPullRequest(
    request: WorkRequest,
    body: string,
    comments: Array<{ path: string; line: number; body: string }>,
  ): Promise<void>;
  getDefaultBranch(request: WorkRequest): Promise<string>;
  getIssue(request: WorkRequest): Promise<IssueContext>;
  getPullRequest(request: WorkRequest): Promise<PullRequestContext>;
  getInstallationToken(request: WorkRequest): Promise<string>;
  createPullRequest(
    request: WorkRequest,
    input: { head: string; base: string; title: string; body: string },
  ): Promise<{ number: number; url: string }>;
}

export interface CodexResult {
  finalResponse: string;
  threadId: string;
}

export interface CodexPort {
  run(
    workingDirectory: string,
    prompt: string,
    options: { model: string; reasoningEffort: ReasoningEffort; outputSchema: object },
  ): Promise<CodexResult>;
}
