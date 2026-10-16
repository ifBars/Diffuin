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
  commentKind?: "issue" | "review_comment" | "review" | "triage";
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
  labels?: string[];
  state?: string;
  isPullRequest?: boolean;
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
  author?: string;
  state?: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  headRepository: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: string[];
}

export interface PullRequestReviewContext {
  id: number;
  actor: string;
  state: string;
  body: string;
  comments: Array<{
    id: number;
    body: string;
    path: string;
    line: number | null;
    diffHunk: string;
    replyTo?: number;
  }>;
}

export interface ScheduleOneReferences {
  skillPath: string;
  regularSourcePath?: string | undefined;
  betaSourcePath?: string | undefined;
  assetRipperPath?: string | undefined;
  warnings: string[];
  snapshots?: readonly ReferenceSnapshot[];
}

export interface ReferenceSnapshot {
  id: string;
  label: string;
  repository: string;
  branch: string;
  path: string;
  revision: string;
  commitSubject: string;
  commitDate: string;
  checkedAt: string;
  freshness: "refreshed" | "stale";
  depth: number;
  paths: readonly string[];
  runtime?: "mono" | "il2cpp" | "source" | undefined;
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
  referenceSnapshots?: readonly ReferenceSnapshot[];
}

export interface AgentProfilePort {
  prepare(request?: WorkRequest): Promise<AgentProfileContext>;
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
    references?: readonly ReferenceSnapshot[],
  ): GitHubReadSession;
}

export interface GitHubPort {
  listIssueLabels?(request: WorkRequest): Promise<Array<{ name: string; description: string | null }>>;
  applyIssueTriage?(request: WorkRequest, input: { title: string; addLabels: string[]; expected: IssueContext }): Promise<void>;
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
  hasBranch?(request: WorkRequest, branch: string): Promise<boolean>;
  getTrustedReferenceSha?(request: WorkRequest): Promise<string>;
  listReviewCommentReactions?(
    request: WorkRequest,
    commentId: number,
  ): Promise<Array<{ actor: string; signal: "positive" | "negative" }>>;
  getIssue(request: WorkRequest): Promise<IssueContext>;
  getPullRequest(request: WorkRequest): Promise<PullRequestContext>;
  getPullRequestReview?(request: WorkRequest): Promise<PullRequestReviewContext>;
  replyToReviewComment?(request: WorkRequest, commentId: number, body: string): Promise<void>;
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
