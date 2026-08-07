export type TriggerKind = "issue" | "pull_request";

export interface MentionCommand {
  task: string;
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
  comment(request: WorkRequest, body: string): Promise<void>;
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
  run(workingDirectory: string, prompt: string): Promise<CodexResult>;
}
