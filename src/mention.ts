import type { MentionCommand, ReasoningEffort, TaskMode } from "./types.js";

const MODES = new Set<TaskMode>(["review", "investigate", "plan", "implement", "answer"]);
const EFFORTS = new Set<ReasoningEffort>(["minimal", "low", "medium", "high", "xhigh", "max"]);
const CLAUSE_START = String.raw`(?:^|[.!?]\s+|,\s*|\b(?:and|then)\s+)`;
const REQUEST_PREFIX = String.raw`(?:(?:please\s+)|(?:(?:can|could|would|will)\s+you\s+)|(?:i(?:'d|\s+would)\s+like\s+you\s+to\s+)|(?:i\s+need\s+you\s+to\s+))*`;
const IMPLEMENT_ACTION = String.raw`(?:add|change|delete|drop|fix|implement|move|remove|rename|replace|restore|revert|update)\b`;
const OPEN_PULL_REQUEST = String.raw`(?:open|create|raise|submit)\s+(?:an?\s+)?(?:pull\s+request|pr)\b`;
const PLAN_ACTION = String.raw`(?:(?:create|develop|draft|make|produce|write)\s+(?:an?\s+)?(?:implementation[- ]ready\s+)?plan\b|plan\s+(?:this|that|the|an?\b|how\b))`;
const REVIEW_ACTION = String.raw`(?:audit|review)\b`;
const INVESTIGATE_ACTION = String.raw`(?:analy[sz]e|investigate|research)\b`;
const ANSWER_ACTION = String.raw`(?:answer|describe|explain|tell\s+me)\b`;
const DELIVERABLE_RANK: Record<TaskMode, number> = {
  auto: 0,
  answer: 1,
  investigate: 2,
  review: 2,
  plan: 3,
  implement: 4,
};

export function parseMention(body: string, handle: string): MentionCommand | null {
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`(?:^|\\s)@${escaped}(?=\\s|$|[,:])`, "i"));
  if (!match || match.index === undefined) {
    return null;
  }

  const commandText = body.slice(match.index + match[0].length).replace(/^[\s,:-]+/, "").trim();
  if (!commandText) {
    return null;
  }

  const [first = "", ...remaining] = commandText.split(/\s+/);
  const normalizedMode = first.toLowerCase() as TaskMode;
  if (!MODES.has(normalizedMode)) {
    return { task: commandText, mode: inferNaturalLanguageMode(commandText) };
  }

  const inferredMode = inferNaturalLanguageMode(commandText);
  const hasExplicitSyntax = remaining.some((token) => token === "--" || token.startsWith("--"));
  if (!hasExplicitSyntax && DELIVERABLE_RANK[inferredMode] > DELIVERABLE_RANK[normalizedMode]) {
    return { task: commandText, mode: inferredMode };
  }

  return parseExplicitCommand(normalizedMode, remaining);
}

function inferNaturalLanguageMode(task: string): TaskMode {
  const matchesAction = (action: string): boolean =>
    new RegExp(`${CLAUSE_START}${REQUEST_PREFIX}(?:${action})`, "i").test(task);
  const trimmed = task.trim();

  if (/^(?:how|what|why|where|which|when|should|do|does|did|is|are|was|were)\b/i.test(trimmed) &&
    (!trimmed.includes("?") || trimmed.endsWith("?"))) {
    return "answer";
  }

  // Resolve the requested deliverable, not merely the first activity named in
  // a compound request. Research may feed a plan, and review may feed a fix.
  if (matchesAction(`${IMPLEMENT_ACTION}|${OPEN_PULL_REQUEST}`)) return "implement";
  if (matchesAction(PLAN_ACTION)) return "plan";
  if (matchesAction(REVIEW_ACTION)) return "review";
  if (matchesAction(INVESTIGATE_ACTION)) return "investigate";
  if (matchesAction(ANSWER_ACTION)) return "answer";
  return "auto";
}

function parseExplicitCommand(mode: TaskMode, tokens: string[]): MentionCommand {
  let requestedModel: string | undefined;
  let requestedReasoningEffort: ReasoningEffort | undefined;
  let index = 0;

  while (index < tokens.length && tokens[index] !== "--") {
    const token = tokens[index]!;
    if (token === "--model" || token.startsWith("--model=")) {
      const parsed = optionValue(token, tokens[index + 1]);
      if (!parsed.value || !/^[A-Za-z0-9._-]+$/.test(parsed.value)) {
        return invalid(mode, "--model requires a model identifier such as gpt-5.6-luna");
      }
      requestedModel = parsed.value;
      index += parsed.consumed;
      continue;
    }
    if (token === "--effort" || token.startsWith("--effort=")) {
      const parsed = optionValue(token, tokens[index + 1]);
      if (!parsed.value || !EFFORTS.has(parsed.value as ReasoningEffort)) {
        return invalid(mode, "--effort must be one of minimal, low, medium, high, xhigh, or max");
      }
      requestedReasoningEffort = parsed.value as ReasoningEffort;
      index += parsed.consumed;
      continue;
    }
    if (token.startsWith("--")) {
      return invalid(mode, `unknown option ${token}`);
    }
    break;
  }

  if (tokens[index] === "--") {
    index += 1;
  }
  const task = tokens.slice(index).join(" ").trim() || defaultTask(mode);
  return { task, mode, requestedModel, requestedReasoningEffort };
}

function optionValue(token: string, next: string | undefined): { value: string | undefined; consumed: number } {
  const equals = token.indexOf("=");
  return equals >= 0
    ? { value: token.slice(equals + 1), consumed: 1 }
    : { value: next?.startsWith("--") ? undefined : next, consumed: 2 };
}

function invalid(mode: TaskMode, error: string): MentionCommand {
  return { task: defaultTask(mode), mode, error };
}

function defaultTask(mode: TaskMode): string {
  switch (mode) {
    case "review": return "review this pull request";
    case "investigate": return "investigate the likely cause of this issue";
    case "plan": return "produce an implementation plan for this issue";
    case "implement": return "implement the requested change";
    case "answer": return "answer the request";
    default: return "handle the request";
  }
}

export function canWrite(permission: string): boolean {
  return permission === "admin" || permission === "maintain" || permission === "write";
}
