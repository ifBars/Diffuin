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
  "allowedCodexModels" | "autoReasoningRouting" | "codexModel" | "codexReasoningEffort"
>;

const HIGH_RISK = /\b(network|multiplayer|fishnet|rpc|authority|server|client|save|load|persist|migration|il2cpp|mono|harmony|patch|lifecycle|concurr|thread|security|authentication|database|schema|protocol|public api|breaking)\b/i;

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
  const model = job.requestedModel ?? config.codexModel;
  if (job.requestedReasoningEffort) {
    return { mode, model, reasoningEffort: job.requestedReasoningEffort, reason: "explicit mention override" };
  }
  if (!config.autoReasoningRouting) {
    return {
      mode,
      model,
      reasoningEffort: config.codexReasoningEffort,
      reason: "automatic routing disabled",
    };
  }

  const text = [job.task, issue.title, issue.body ?? "", ...(pullRequest?.files ?? [])].join("\n");
  const riskMatches = text.match(new RegExp(HIGH_RISK.source, "gi"))?.length ?? 0;
  const changedLines = pullRequest ? pullRequest.additions + pullRequest.deletions : 0;

  if (mode === "auto") {
    const complex = riskMatches >= 1 || changedLines >= 600 || text.length > 4_000;
    return {
      mode,
      model,
      reasoningEffort: complex ? "xhigh" : "high",
      reason: complex ? "complex agent-directed request" : "agent-directed request",
    };
  }

  if (mode === "plan") {
    const complex = text.length > 10_000 || (text.length > 5_000 && riskMatches >= 6);
    return {
      mode,
      model,
      reasoningEffort: complex ? "max" : "xhigh",
      reason: complex ? "complex or high-risk issue plan" : "source-backed issue plan",
    };
  }

  if (mode === "investigate") {
    const complex = riskMatches >= 1 || text.length > 1_200;
    return {
      mode,
      model,
      reasoningEffort: complex ? "xhigh" : "high",
      reason: complex ? "non-trivial source-backed investigation" : "focused source-backed investigation",
    };
  }

  if (mode === "review" && pullRequest) {
    if (pullRequest.changedFiles >= 20 || changedLines >= 2_000 || riskMatches >= 8) {
      return { mode, model, reasoningEffort: "max", reason: "large or high-risk pull request" };
    }
    if (pullRequest.changedFiles >= 8 || changedLines >= 600 || riskMatches >= 3) {
      return { mode, model, reasoningEffort: "xhigh", reason: "non-trivial pull request" };
    }
    if (pullRequest.changedFiles <= 3 && changedLines <= 150 && riskMatches === 0) {
      return { mode, model, reasoningEffort: "medium", reason: "small low-risk pull request" };
    }
    return { mode, model, reasoningEffort: "high", reason: "ordinary pull request" };
  }

  if (mode === "implement") {
    const complex = riskMatches >= 3 || changedLines >= 600 || text.length > 4_000;
    return {
      mode,
      model,
      reasoningEffort: complex ? "xhigh" : "high",
      reason: complex ? "non-trivial implementation" : "bounded implementation",
    };
  }

  const needsDepth = riskMatches >= 2 || text.length > 3_000;
  return {
    mode,
    model,
    reasoningEffort: needsDepth ? "high" : "medium",
    reason: needsDepth ? "source-backed technical answer" : "focused answer",
  };
}
