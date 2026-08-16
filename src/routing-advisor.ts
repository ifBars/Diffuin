import { Codex } from "@openai/codex-sdk";
import { join } from "node:path";
import { z } from "zod";
import type { Config } from "./config.js";
import { sanitizedEnvironment } from "./environment.js";
import type { ExecutionRoute } from "./routing.js";
import type { IssueContext, Job, PullRequestContext, ReasoningEffort } from "./types.js";

const ADVISOR_REASONING_EFFORT = "medium" as const;
const MAX_TASK_CHARS = 2_000;
const MAX_CONTEXT_CHARS = 4_000;
const MAX_FILES = 80;

const ambiguousReasons = new Set([
  "ordinary pull request",
  "non-trivial pull request",
  "source-backed technical request",
  "focused source-backed request",
  "bounded implementation",
  "coupled implementation",
  "coupled source-backed request",
  "multi-surface request",
]);

const adviceSchema = z.object({
  model: z.string().min(1).max(128),
  reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh", "max"]),
  confidence: z.enum(["low", "medium", "high"]),
  reasonCode: z.enum(["speed", "scope", "complexity", "risk", "balanced"]),
}).strict();

const reasoningRank: Record<ReasoningEffort, number> = {
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

type RoutingAdvisorConfig = Pick<
  Config,
  "allowedCodexModels" | "dataDir" | "routingAdvisorModel" | "routingAdvisorTimeoutMs" |
  "sparkModels" | "sparkReasoningEffort"
>;

export interface RoutingAdvisorPort {
  advise(
    job: Job,
    issue: IssueContext,
    pullRequest: PullRequestContext | null,
    baseline: ExecutionRoute,
  ): Promise<ExecutionRoute | null>;
}

export type RoutingAdvisorRunner = (prompt: string, outputSchema: object) => Promise<string>;

export class CodexRoutingAdvisor implements RoutingAdvisorPort {
  private readonly runner: RoutingAdvisorRunner;

  constructor(
    private readonly config: RoutingAdvisorConfig,
    runner?: RoutingAdvisorRunner,
  ) {
    this.runner = runner ?? createCodexRunner(config);
  }

  async advise(
    job: Job,
    issue: IssueContext,
    pullRequest: PullRequestContext | null,
    baseline: ExecutionRoute,
  ): Promise<ExecutionRoute | null> {
    if (!shouldConsultRoutingAdvisor(job, baseline)) {
      return null;
    }

    const allowedModels = [...this.config.allowedCodexModels].sort();
    const response = await this.runner(
      buildAdvisorPrompt(job, issue, pullRequest, baseline, allowedModels),
      routingAdviceOutputSchema(allowedModels),
    );
    const advice = adviceSchema.parse(JSON.parse(response));
    if (advice.confidence === "low") {
      return null;
    }
    if (!this.config.allowedCodexModels.has(advice.model)) {
      throw new Error(`routing advisor selected disallowed model ${advice.model}`);
    }

    const floor = reasoningFloor(baseline.reason);
    if (this.config.sparkModels.has(advice.model)) {
      if (reasoningRank[this.config.sparkReasoningEffort] < reasoningRank[floor]) {
        return null;
      }
      return {
        mode: baseline.mode,
        model: advice.model,
        reasoningEffort: this.config.sparkReasoningEffort,
        reason: advisorReason(advice.reasonCode, advice.confidence, baseline.reason),
      };
    }

    const reasoningEffort = reasoningRank[advice.reasoningEffort] < reasoningRank[floor]
      ? floor
      : advice.reasoningEffort;
    return {
      mode: baseline.mode,
      model: advice.model,
      reasoningEffort,
      reason: advisorReason(advice.reasonCode, advice.confidence, baseline.reason),
    };
  }
}

export function shouldConsultRoutingAdvisor(job: Job, baseline: ExecutionRoute): boolean {
  if (job.requestedModel || job.requestedReasoningEffort) {
    return false;
  }
  if (baseline.reason.startsWith("speed-prioritized review") ||
    baseline.reason === "automatic routing disabled") {
    return false;
  }
  return ambiguousReasons.has(baseline.reason);
}

function createCodexRunner(config: RoutingAdvisorConfig): RoutingAdvisorRunner {
  return async (prompt, outputSchema) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.routingAdvisorTimeoutMs);
    try {
      const codex = new Codex({
        config: {
          model_reasoning_effort: ADVISOR_REASONING_EFFORT,
          features: { apps: false, plugins: false },
        },
        env: sanitizedEnvironment({ CODEX_HOME: join(config.dataDir, "codex-home") }),
      });
      const thread = codex.startThread({
        model: config.routingAdvisorModel,
        modelReasoningEffort: ADVISOR_REASONING_EFFORT,
        workingDirectory: config.dataDir,
        skipGitRepoCheck: true,
        sandboxMode: "read-only",
        networkAccessEnabled: false,
        webSearchMode: "disabled",
        approvalPolicy: "never",
      });
      const result = await thread.run(prompt, { outputSchema, signal: controller.signal });
      if (!result.finalResponse) {
        throw new Error("routing advisor completed without a response");
      }
      return result.finalResponse;
    } finally {
      clearTimeout(timeout);
    }
  };
}

function buildAdvisorPrompt(
  job: Job,
  issue: IssueContext,
  pullRequest: PullRequestContext | null,
  baseline: ExecutionRoute,
  allowedModels: readonly string[],
): string {
  const indicators = {
    mode: job.mode,
    task: bounded(job.task, MAX_TASK_CHARS),
    issue: {
      title: bounded(issue.title, MAX_CONTEXT_CHARS),
      body: bounded(issue.body ?? "", MAX_CONTEXT_CHARS),
    },
    pullRequest: pullRequest ? {
      additions: pullRequest.additions,
      deletions: pullRequest.deletions,
      changedFiles: pullRequest.changedFiles,
      files: pullRequest.files.slice(0, MAX_FILES),
    } : null,
    deterministicBaseline: baseline,
    allowedModels,
  };

  return [
    "Select the best execution model and reasoning effort for this GitHub engineering task.",
    "Do not use tools or inspect the filesystem. Decide only from the supplied indicators.",
    "Return exactly the requested JSON schema.",
    "Guidelines:",
    "- gpt-5.3-codex-spark is the fast route and uses medium reasoning; choose it only when speed matters and the task is bounded.",
    "- gpt-5.6-luna is the default for small, focused, low-risk changes and reviews. Prefer Luna with high reasoning over Terra when Luna can produce the same correct result.",
    "- gpt-5.6-terra is for work with concrete complexity that exceeds a focused Luna task, such as several interacting code paths or material ambiguity.",
    "- gpt-5.6-sol is the frontier choice for unusually difficult or high-risk work.",
    "- Medium is the default balance. Choose high or above only when complexity or risk justifies the latency.",
    "- A request for tests, Mono/IL2CPP checks, or careful validation does not by itself make a small code change complex.",
    "- Prefer the least expensive model that can confidently deliver the smallest complete patch. Do not escalate for polish, optional abstractions, or speculative edge cases.",
    "- Preserve or increase the deterministic baseline when the indicators show coupled behavior, compatibility risk, security, or a broad diff.",
    `Indicators: ${JSON.stringify(indicators)}`,
  ].join("\n");
}

function routingAdviceOutputSchema(allowedModels: readonly string[]): object {
  return {
    type: "object",
    properties: {
      model: { type: "string", enum: allowedModels },
      reasoningEffort: { type: "string", enum: ["minimal", "low", "medium", "high", "xhigh", "max"] },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      reasonCode: { type: "string", enum: ["speed", "scope", "complexity", "risk", "balanced"] },
    },
    required: ["model", "reasoningEffort", "confidence", "reasonCode"],
    additionalProperties: false,
  };
}

function reasoningFloor(reason: string): ReasoningEffort {
  return /(?:non-trivial|coupled|multi-surface)/.test(reason) ? "high" : "medium";
}

function advisorReason(reasonCode: string, confidence: string, baselineReason: string): string {
  return `Luna advisor: ${reasonCode} (${confidence}); baseline ${baselineReason}`;
}

function bounded(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}
