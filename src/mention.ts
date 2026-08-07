import type { MentionCommand } from "./types.js";

export function parseMention(body: string, handle: string): MentionCommand | null {
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`(?:^|\\s)@${escaped}(?=\\s|$|[,:])`, "i"));
  if (!match || match.index === undefined) {
    return null;
  }

  const task = body.slice(match.index + match[0].length).replace(/^[\s,:-]+/, "").trim();
  return task.length > 0 ? { task } : null;
}

export function canWrite(permission: string): boolean {
  return permission === "admin" || permission === "maintain" || permission === "write";
}
