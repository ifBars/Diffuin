import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeExecution } from "../src/routing.js";
import type { IssueContext, Job, PullRequestContext, ReasoningEffort } from "../src/types.js";

const config = {
  codexModel: "gpt-5.6-luna",
  allowedCodexModels: new Set(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]),
  sparkModels: new Set(["gpt-5.3-codex-spark"]),
  sparkReasoningEffort: "medium" as const,
  codexReasoningEffort: "max" as const,
  autoReasoningRouting: true,
};

const baseJob = {
  id: "job",
  deliveryId: "delivery",
  installationId: 1,
  repositoryId: 2,
  repository: "ifBars/S1API",
  owner: "ifBars",
  repo: "S1API",
  issueNumber: 1,
  commentId: 3,
  actor: "ifBars",
  kind: "issue",
  task: "Research and create an implementation plan.",
  mode: "auto",
  closeIssueOnMerge: false,
  status: "running",
  createdAt: "now",
  updatedAt: "now",
} satisfies Job;

interface CalibrationCase {
  name: string;
  task: string;
  issue: IssueContext;
  pullRequest?: PullRequestContext;
  expectedModel: string;
  expectedEffort: ReasoningEffort;
}

const cases: CalibrationCase[] = [
  {
    name: "#215 bounded smoke request",
    task: "Check that the default branch can be read and report what you find.",
    issue: { title: "Diffuin smoke test", body: "Temporary read-only verification." },
    expectedModel: "gpt-5.6-luna",
    expectedEffort: "medium",
  },
  {
    name: "#218 focused source-backed investigation",
    task: "Research this issue accordingly.",
    issue: {
      title: "Custom NPCs do not respect property boundaries",
      body: "Inspect the IL2CPP behavior for a custom NPC entering a property.",
    },
    expectedModel: "gpt-5.6-terra",
    expectedEffort: "high",
  },
  {
    name: "#223 cross-runtime dialogue API plan",
    task: "Research and plan this.",
    issue: {
      title: "Expose dialogue node and completion events",
      body: "Add an API without direct Harmony access and keep behavior compatible across Mono and IL2CPP.",
    },
    expectedModel: "gpt-5.6-terra",
    expectedEffort: "high",
  },
  {
    name: "#245 narrow networking guard plan",
    task: "Create an implementation plan for the above-described NPC.Panic fix.",
    issue: {
      title: "NPC.Panic silently does nothing for non-host clients",
      body: "Remove or narrow a redundant server guard around a client-callable RPC and test both runtimes.",
    },
    expectedModel: "gpt-5.6-terra",
    expectedEffort: "high",
  },
  {
    name: "#246 coupled revive lifecycle plan",
    task: "Research and create an implementation plan for this bug.",
    issue: {
      title: "Custom NPC revive bypasses authoritative networking after spawn",
      body: "Use the fallback only before the FishNet lifecycle initializes. Preserve server authority, replicated state, save/load restoration, and repeated death/revive behavior.",
    },
    expectedModel: "gpt-5.6-luna",
    expectedEffort: "xhigh",
  },
  {
    name: "#251 narrow reflection fallback plan",
    task: "Research and create an implementation plan for this issue.",
    issue: {
      title: "Expected NPCAction reflection fallback emits AccessTools warning",
      body: "Mono exposes a field while IL2CPP exposes a property. Replace the noisy Harmony probe without changing behavior.",
    },
    expectedModel: "gpt-5.6-terra",
    expectedEffort: "high",
  },
  {
    name: "#253 focused removal ignores inherited PR complexity",
    task: "Remove NPCScheduleReflectionTests so its just the fix in NPCPatches",
    issue: {
      title: "Resolve NPCAction owner without AccessTools warnings",
      body: "The original implementation discusses Mono, IL2CPP, Harmony patches, lifecycle, save/load, networking, and multiplayer validation.",
    },
    pullRequest: {
      title: "Resolve NPCAction owner without AccessTools warnings",
      body: "A cross-runtime implementation with extensive validation notes.",
      baseBranch: "stable",
      headBranch: "diffuin/251-104845f1",
      headSha: "abc",
      headRepository: "ifBars/S1API",
      additions: 97,
      deletions: 6,
      changedFiles: 2,
      files: ["S1API/Internal/Patches/NPCPatches.cs", "S1API.Tests/Entities/NPCScheduleReflectionTests.cs"],
    },
    expectedModel: "gpt-5.6-luna",
    expectedEffort: "medium",
  },
  {
    name: "#233 large review",
    task: "review plz",
    issue: { title: "Add custom furniture API", body: "Review the complete pull request." },
    pullRequest: {
      title: "Add custom furniture API",
      body: "Large public API change.",
      baseBranch: "stable",
      headBranch: "feat/furniture",
      headSha: "def",
      headRepository: "ifBars/S1API",
      additions: 1_567,
      deletions: 5,
      changedFiles: 22,
      files: Array.from({ length: 22 }, (_, index) => `file-${index}.cs`),
    },
    expectedModel: "gpt-5.6-luna",
    expectedEffort: "max",
  },
];

describe("historical S1API routing calibration", () => {
  for (const calibration of cases) {
    it(calibration.name, () => {
      const kind = calibration.pullRequest ? "pull_request" as const : "issue" as const;
      const job: Job = { ...baseJob, kind, task: calibration.task };
      const route = routeExecution(job, calibration.issue, calibration.pullRequest ?? null, config);
      assert.equal(route.model, calibration.expectedModel);
      assert.equal(route.reasoningEffort, calibration.expectedEffort);
    });
  }
});
