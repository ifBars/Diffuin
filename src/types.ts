export type TriggerKind = "issue" | "pull_request";
export type TaskMode = "auto" | "review" | "investigate" | "plan" | "implement" | "answer";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type HarnessProvider = "codex" | "spark";
export type AgentProfileId = "general" | "schedule-one";
export type MemoryScope = "repository" | "path" | "user";
export type MemoryKind = "fact" | "preference" | "precedent" | "warning";

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

export interface ProjectMemory {
  id: string;
  repositoryId: number;
  repository: string;
  scope: MemoryScope;
  actor: string;
  kind: MemoryKind;
  text: string;
  rationale?: string | undefined;
  pathGlob?: string | undefined;
  evidenceUrl: string;
  sourceSha?: string | undefined;
  status: "approved" | "rejected" | "stale" | "promoted";
  createdAt: string;
  lastVerifiedAt?: string | undefined;
}

export interface MemoryCommand extends WorkRequest {
  memoryAction: "remember" | "forget" | "list";
  memoryScope?: MemoryScope | undefined;
  memoryKind?: MemoryKind | undefined;
  memoryText?: string | undefined;
  memoryRationale?: string | undefined;
  memoryPathGlob?: string | undefined;
  memorySourceSha?: string | undefined;
  memoryId?: string | undefined;
  evidenceUrl: string;
}

export interface FeedbackEvent extends WorkRequest {
  externalCommentId: number;
  signal: "positive" | "negative";
  operation: "add" | "remove";
  body?: string | undefined;
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

export interface AgentProfileContext {
  id: AgentProfileId;
  identity: string;
  primaryJobs: readonly string[];
  validationBoundary: string;
  skillRoot: string;
  domainSkillPath?: string | undefined;
  evidenceContext: string;
  behaviorGuidance: string;
  readRoots: readonly string[];
  assetRipperPath?: string | undefined;
}

export interface AgentProfilePort {
  prepare(): Promise<AgentProfileContext>;
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
  openSession(
    request: WorkRequest,
    context: IssueContext,
    repositoryGuidance?: readonly string[],
  ): GitHubReadSession;
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
  ): Promise<number[]>;
  getDefaultBranch(request: WorkRequest): Promise<string>;
  getTrustedReferenceSha?(request: WorkRequest): Promise<string>;
  listReviewCommentReactions?(
    request: WorkRequest,
    commentId: number,
  ): Promise<Array<{ actor: string; signal: "positive" | "negative" }>>;
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
