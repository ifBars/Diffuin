import type { MentionCommand, ReasoningEffort, TaskMode } from "./types.js";

const MODES = new Set<TaskMode>(["review", "plan", "implement", "answer"]);
const EFFORTS = new Set<ReasoningEffort>(["minimal", "low", "medium", "high", "xhigh", "max"]);

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
    return { task: commandText, mode: "auto" };
  }

  return parseExplicitCommand(normalizedMode, remaining);
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
    case "plan": return "produce an implementation plan for this issue";
    case "implement": return "implement the requested change";
    case "answer": return "answer the request";
    default: return "handle the request";
  }
}

export function canWrite(permission: string): boolean {
  return permission === "admin" || permission === "maintain" || permission === "write";
}
