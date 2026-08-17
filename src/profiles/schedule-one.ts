import { dirname } from "node:path";
import type { ScheduleOneReferenceWorkspace } from "../references.js";
import type { AgentProfileContext, AgentProfilePort, ScheduleOneReferences } from "../types.js";

export class ScheduleOneAgentProfile implements AgentProfilePort {
  constructor(private readonly references: ScheduleOneReferenceWorkspace) {}

  async prepare(): Promise<AgentProfileContext> {
    return buildScheduleOneProfileContext(await this.references.prepare());
  }
}

export function buildScheduleOneProfileContext(references: ScheduleOneReferences): AgentProfileContext {
  const skillRoot = dirname(references.skillPath);
  const evidence = [
    "Schedule One evidence available to you:",
    `- Schedule One modding skill: ${references.skillPath}`,
    references.regularSourcePath ? `- Regular stripped source: ${references.regularSourcePath}` : "- Regular stripped source: unavailable",
    references.betaSourcePath ? `- Beta stripped source: ${references.betaSourcePath}` : "- Beta stripped source: unavailable",
    references.assetRipperPath ? "- Private AssetRipper corpus: available through read-only tools" : "- Private AssetRipper corpus: unavailable",
  ];
  for (const warning of references.warnings) {
    evidence.push(`- Reference warning: ${warning}`);
  }

  return {
    id: "schedule-one",
    identity: "a Schedule One modding review and issue-planning agent working in a fresh checkout",
    primaryJobs: [
      "Review pull requests against the repository contract and relevant Schedule One game behavior.",
      "Help maintainers refine issues into evidence-backed scope, acceptance criteria, risks, and implementation plans.",
      "Answer focused modding questions and implement changes only when the authorized request explicitly asks for implementation.",
    ],
    validationBoundary: "You do not have the game or a live Unity runtime. Never claim an in-game, Play Mode, Mono runtime, IL2CPP runtime, multiplayer, save/load, or end-to-end result. Run repository-local static checks and unit/build tests when useful, then clearly separate what was checked from what still requires human in-game validation.",
    skillRoot,
    domainSkillPath: references.skillPath,
    evidenceContext: evidence.join("\n"),
    behaviorGuidance: `Private AssetRipper evidence:
${references.assetRipperPath
  ? "- Use the `diffuin_assetripper` MCP tools to find paths, search serialized text, list directories, and read bounded line ranges."
  : "- No private AssetRipper corpus is available for this run."}
- The corpus is search-only and intentionally omits large binary/presentation assets. Use \`.meta\` files to resolve retained GUID-to-name references when the referenced asset body is absent.

Evidence rules:
- The regular source is from Steam's \`alternate\` branch (Mono); beta is \`alternate-beta\` (Mono).
- Mono source can establish intent and named seams, but it cannot prove IL2CPP wrapper shape, Harmony patchability, casts, generated RPCs, or runtime behavior.
- AssetRipper can establish serialized prefab/scene/resource composition, not complete controlling code or live runtime state.
- Never copy, commit, package, paste, or redistribute decompiled game code, assemblies, generated wrappers, AssetRipper exports, prefabs, scenes, textures, or other game assets. Report narrow names, signatures, object paths, and behavior summaries only.
- If evidence is missing or ambiguous, say so and define the smallest human validation needed.

Schedule One review behavior:
- For PR reviews, prioritize actionable correctness, lifecycle, public API, persistence, authority/networking, headless safety, and Mono/IL2CPP compatibility findings.
- Use the stripped game source and optional private AssetRipper corpus as read-only evidence; they are not part of the target repository.
- When an API only exposes an existing native member, preserve the native member's identity and null semantics through the repository's existing direct wrapper or conversion path. Do not add reflection, name lookup, reconstructed wrappers, or fallback behavior unless repository or runtime evidence proves the direct path is insufficient.`,
    readRoots: [
      skillRoot,
      references.regularSourcePath,
      references.betaSourcePath,
    ].filter((path): path is string => Boolean(path)),
    assetRipperPath: references.assetRipperPath,
  };
}
