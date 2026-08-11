export type TriggerKind = "issue" | "pull_request";
export type TaskMode = "auto" | "review" | "investigate" | "plan" | "implement" | "answer";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type HarnessProvider = "codex" | "spark";

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
  closeIssueOnMerge: boolean;
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
  comments?: IssueCommentContext[];
}

export interface IssueCommentContext {
  id: number;
  author: string;
  body: string;
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

export interface GitHubReadSource {
  readRepository(request: WorkRequest, repository: string): Promise<unknown>;
  readFile(request: WorkRequest, repository: string, path: string, ref?: string): Promise<unknown>;
  searchCode(request: WorkRequest, repository: string, query: string): Promise<unknown>;
  readIssue(request: WorkRequest, repository: string, number: number): Promise<unknown>;
  readPullRequest(request: WorkRequest, repository: string, number: number): Promise<unknown>;
}

export interface GitHubReadSession {
  url: string;
  token: string;
  repositories: readonly string[];
  close(): void;
}

export interface AssetRipperReadSession {
  url: string;
  token: string;
  close(): void;
}

export interface AssetRipperReadBrokerPort {
  openSession(root: string | undefined): Promise<AssetRipperReadSession | undefined>;
}

export interface GitHubReadBrokerPort {
  openSession(request: WorkRequest, context: IssueContext): GitHubReadSession;
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
  updateIssue(request: WorkRequest, input: { title: string; body: string }): Promise<void>;
  getInstallationToken(request: WorkRequest): Promise<string>;
  createPullRequest(
    request: WorkRequest,
    input: { head: string; base: string; title: string; body: string },
  ): Promise<{ number: number; url: string }>;
}

export interface CodexResult {
  finalResponse: string;
  threadId: string;
  provider?: HarnessProvider;
}

export interface CodexPort {
  run(
    workingDirectory: string,
    prompt: string,
    options: {
      model: string;
      reasoningEffort: ReasoningEffort;
      outputSchema: object;
      readRoots?: readonly string[];
      githubReadSession?: GitHubReadSession;
      assetRipperReadSession?: AssetRipperReadSession;
    },
  ): Promise<CodexResult>;
}
