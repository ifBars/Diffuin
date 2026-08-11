import type { Config } from "./config.js";
import type { IssueContext, Job, PullRequestContext, ReasoningEffort, TaskMode, WorkRequest } from "./types.js";

export interface ExecutionRoute {
  mode: TaskMode;
  model: string;
  reasoningEffort: ReasoningEffort;
  reason: string;
}

type RoutingConfig = Pick<
  Config,
  "allowedCodexModels" | "autoReasoningRouting" | "codexModel" | "codexReasoningEffort" | "sparkModels" |
  "sparkReasoningEffort"
>;

interface EffortRoute {
  reasoningEffort: ReasoningEffort;
  reason: string;
}

const REASONING_RANK: Record<ReasoningEffort, number> = {
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

const BALANCED_MODEL = "gpt-5.6-terra";
const DEEP_MODEL = "gpt-5.6-luna";

const SOURCE_BACKED = /\b(research|investigat(?:e|ion)|analy[sz]e|implementation(?:-ready)? plan|plan (?:this|the|an?))\b/i;
const BROAD_SCOPE = /\b(all|every|entire|comprehensive|thorough|exhaustive|repository-wide|repo-wide|codebase-wide|across (?:the )?(?:repository|codebase|modules?))\b/i;
const REVIEW_REQUEST = /\b(review|audit)\b/i;
const SPEED_REVIEW_SIGNALS = [
  /\b(?:quick|fast|rapid|speedy)\s+(?:(?:code|pr|pull request)\s+)?(?:review|audit|pass|look)\b/i,
  /\b(?:review|audit)\s+(?:this\s+)?(?:quickly|fast|rapidly)\b/i,
  /\b(?:quickly|rapidly)\s+(?:review|audit)\b/i,
] as const;
const FOCUSED_QUESTION = /^\s*(?:please\s+)?(?:how|what|why|where|which|can|does|do|is|are)\b/i;
const FOCUSED_CHANGE = /^\s*(?:please\s+)?(?:add|change|delete|drop|fix|move|remove|rename|replace|restore|revert|update)\b/i;

const DEEP_SIGNALS = [
  /\b(network|multiplayer|fishnet|rpc|authority|server|client)\b/i,
  /\b(save|load|persist|migration|reconnect|late[- ]join)\b/i,
  /\b(lifecycle|state machine)\b/i,
  /\b(concurr|thread|race condition|deadlock)\b/i,
  /\b(security|authentication|authorization|permission)\b/i,
  /\b(database|schema|protocol)\b/i,
  /\b(public api|breaking change|compatibility contract)\b/i,
] as const;

const COMPATIBILITY_SIGNALS = [
  /\b(il2cpp|mono|cross[- ]runtime)\b/i,
  /\b(harmony|reflection|patch)\b/i,
  /\b(unity|native wrapper|interop)\b/i,
] as const;

export function validateOverrides(job: WorkRequest, config: RoutingConfig): string | null {
  if (job.commandError) {
    return job.commandError;
  }
  if (job.requestedModel && !config.allowedCodexModels.has(job.requestedModel)) {
    return `model ${job.requestedModel} is not allowed; choose one of ${[...config.allowedCodexModels].join(", ")}`;
  }
  return null;
}

export function routeExecution(
  job: Job,
  issue: IssueContext,
  pullRequest: PullRequestContext | null,
  config: RoutingConfig,
): ExecutionRoute {
  const mode = job.mode;
  const speedReviewRequested = config.autoReasoningRouting && pullRequest !== null &&
    (mode === "review" || mode === "auto") &&
    SPEED_REVIEW_SIGNALS.some((signal) => signal.test(job.task));
  const speedReviewModel = speedReviewRequested
    ? configuredSparkModel(config)
    : undefined;
  if (!config.autoReasoningRouting) {
    return completeRoute(mode, config.codexReasoningEffort, "automatic routing disabled", job, config, speedReviewModel);
  }

  if (job.requestedReasoningEffort) {
    return completeRoute(mode, job.requestedReasoningEffort, "explicit mention override", job, config, speedReviewModel);
  }

  const task = job.task.trim();
  const context = [issue.title, issue.body ?? "", ...(pullRequest?.files ?? [])].join("\n");
  const taskDepth = countSignals(task, DEEP_SIGNALS);
  const contextDepth = countSignals(context, DEEP_SIGNALS);
  const compatibilityDepth = countSignals(context, COMPATIBILITY_SIGNALS);
  const sourceBacked = SOURCE_BACKED.test(task) || mode === "plan" || mode === "investigate";
  const broad = BROAD_SCOPE.test(task);

  let effort: EffortRoute;
  if (mode === "review" && pullRequest) {
    effort = routeReview(pullRequest, contextDepth + compatibilityDepth);
  } else if (mode === "auto" && pullRequest && REVIEW_REQUEST.test(task)) {
    effort = routeReview(pullRequest, contextDepth + compatibilityDepth);
  } else if (isFocusedRequest(task, taskDepth, broad)) {
    effort = { reasoningEffort: "medium", reason: "bounded request" };
  } else if (sourceBacked) {
    effort = routeSourceBacked(task, context, taskDepth, contextDepth, compatibilityDepth, broad);
  } else if (mode === "implement") {
    effort = contextDepth >= 3 || taskDepth >= 2 || broad
      ? { reasoningEffort: "xhigh", reason: "coupled implementation" }
      : { reasoningEffort: "high", reason: "bounded implementation" };
  } else if (taskDepth >= 2 || broad || task.length > 1_000) {
    effort = { reasoningEffort: "xhigh", reason: "multi-surface request" };
  } else if (taskDepth >= 1 || contextDepth >= 1 || compatibilityDepth >= 1 || task.length > 240) {
    effort = { reasoningEffort: "high", reason: "source-backed technical request" };
  } else {
    effort = { reasoningEffort: "medium", reason: "focused request" };
  }

  const reason = speedReviewModel ? `speed-prioritized review; ${effort.reason}` : effort.reason;
  const speedReviewEffort = speedReviewModel &&
    (effort.reasoningEffort === "xhigh" || effort.reasoningEffort === "max")
    ? reasoningAtLeast(config.sparkReasoningEffort, "high")
    : undefined;
  return completeRoute(mode, effort.reasoningEffort, reason, job, config, speedReviewModel, speedReviewEffort);
}

function routeSourceBacked(
  task: string,
  context: string,
  taskDepth: number,
  contextDepth: number,
  compatibilityDepth: number,
  broad: boolean,
): EffortRoute {
  if (context.length > 10_000 && contextDepth >= 2) {
    return { reasoningEffort: "max", reason: "exceptionally broad source-backed request" };
  }
  if (task.length > 1_500 || taskDepth >= 2 || contextDepth >= 3 || (broad && contextDepth >= 2)) {
    return { reasoningEffort: "xhigh", reason: "coupled source-backed request" };
  }
  if (contextDepth >= 1 || compatibilityDepth >= 1 || context.length > 1_000) {
    return { reasoningEffort: "high", reason: "source-backed technical request" };
  }
  return { reasoningEffort: "high", reason: "focused source-backed request" };
}

function routeReview(pullRequest: PullRequestContext, riskSignals: number): EffortRoute {
  const changedLines = pullRequest.additions + pullRequest.deletions;
  if (pullRequest.changedFiles >= 20 || changedLines >= 2_000 || riskSignals >= 8) {
    return { reasoningEffort: "max", reason: "large or high-risk pull request" };
  }
  if (pullRequest.changedFiles >= 8 || changedLines >= 600 || riskSignals >= 4) {
    return { reasoningEffort: "xhigh", reason: "non-trivial pull request" };
  }
  if (pullRequest.changedFiles <= 3 && changedLines <= 150 && riskSignals === 0) {
    return { reasoningEffort: "medium", reason: "small low-risk pull request" };
  }
  return { reasoningEffort: "high", reason: "ordinary pull request" };
}

function isFocusedRequest(task: string, taskDepth: number, broad: boolean): boolean {
  return task.length <= 240 && taskDepth === 0 && !broad &&
    (FOCUSED_CHANGE.test(task) || FOCUSED_QUESTION.test(task));
}

function countSignals(text: string, signals: readonly RegExp[]): number {
  return signals.reduce((count, signal) => count + Number(signal.test(text)), 0);
}

function completeRoute(
  mode: TaskMode,
  reasoningEffort: ReasoningEffort,
  reason: string,
  job: Job,
  config: RoutingConfig,
  preferredModel?: string,
  preferredSparkReasoningEffort?: ReasoningEffort,
): ExecutionRoute {
  const model = job.requestedModel ?? preferredModel ?? automaticModel(reasoningEffort, config);
  const useSparkDefault = !job.requestedReasoningEffort && config.sparkModels.has(model);
  const effectiveReasoningEffort = useSparkDefault
    ? preferredSparkReasoningEffort ?? config.sparkReasoningEffort
    : reasoningEffort;
  const effectiveReason = useSparkDefault && effectiveReasoningEffort !== reasoningEffort
    ? `${reason}; ${preferredSparkReasoningEffort ? "Spark large-review floor" : "Spark provider default"}`
    : reason;
  return {
    mode,
    model,
    reasoningEffort: effectiveReasoningEffort,
    reason: effectiveReason,
  };
}

function configuredSparkModel(config: RoutingConfig): string | undefined {
  return [...config.sparkModels].find((model) => config.allowedCodexModels.has(model));
}

function reasoningAtLeast(current: ReasoningEffort, floor: ReasoningEffort): ReasoningEffort {
  return REASONING_RANK[current] >= REASONING_RANK[floor] ? current : floor;
}

function automaticModel(reasoningEffort: ReasoningEffort, config: RoutingConfig): string {
  if (!config.autoReasoningRouting) {
    return config.codexModel;
  }
  const preferred = reasoningEffort === "xhigh" || reasoningEffort === "max" ? DEEP_MODEL : BALANCED_MODEL;
  return config.allowedCodexModels.has(preferred) ? preferred : config.codexModel;
}
