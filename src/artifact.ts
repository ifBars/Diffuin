import { z } from "zod";
import type { ExecutionRoute } from "./routing.js";

const findingSchema = z.object({
  severity: z.enum(["P0", "P1", "P2"]),
  title: z.string().min(1).max(140),
  path: z.string().max(300),
  line: z.number().int().min(0),
  body: z.string().min(1).max(1_500),
  recommendation: z.string().min(1).max(800),
});

const taskSchema = z.object({
  description: z.string().min(1).max(800),
  files: z.array(z.string().max(220)).max(4),
});

const phaseSchema = z.object({
  title: z.string().min(1).max(120),
  objective: z.string().min(1).max(600),
  tasks: z.array(taskSchema).max(4),
});

export const artifactSchema = z.object({
  kind: z.enum(["review", "plan", "response"]),
  verdict: z.enum(["approve", "comment", "changes_requested", "not_applicable"]),
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string().min(1).max(2_000),
  findings: z.array(findingSchema).max(6),
  evidence: z.array(z.string().max(1_000)).max(4),
  designChoices: z.array(z.string().max(1_000)).max(3),
  phases: z.array(phaseSchema).max(4),
  validationPerformed: z.array(z.string().max(800)).max(4),
  validationRemaining: z.array(z.string().max(800)).max(4),
  openQuestions: z.array(z.string().max(800)).max(3),
  pullRequestTitle: z.string().max(120).default(""),
  issuePolish: z.object({
    needed: z.boolean(),
    title: z.string().max(256),
    body: z.string().max(20_000),
    reason: z.string().max(1_000),
  }).default({ needed: false, title: "", body: "", reason: "" }),
});

export type DiffuinArtifact = z.infer<typeof artifactSchema>;

export const artifactOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind", "verdict", "confidence", "summary", "findings", "evidence", "designChoices",
    "phases", "validationPerformed", "validationRemaining", "openQuestions", "pullRequestTitle", "issuePolish",
  ],
  properties: {
    kind: { type: "string", enum: ["review", "plan", "response"] },
    verdict: { type: "string", enum: ["approve", "comment", "changes_requested", "not_applicable"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "title", "path", "line", "body", "recommendation"],
        properties: {
          severity: { type: "string", enum: ["P0", "P1", "P2"] },
          title: { type: "string" },
          path: { type: "string" },
          line: { type: "integer", minimum: 0 },
          body: { type: "string" },
          recommendation: { type: "string" },
        },
      },
    },
    evidence: { type: "array", maxItems: 4, items: { type: "string" } },
    designChoices: { type: "array", maxItems: 3, items: { type: "string" } },
    phases: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "objective", "tasks"],
        properties: {
          title: { type: "string" },
          objective: { type: "string" },
          tasks: {
            type: "array",
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["description", "files"],
              properties: {
                description: { type: "string" },
                files: { type: "array", maxItems: 4, items: { type: "string" } },
              },
            },
          },
        },
      },
    },
    validationPerformed: { type: "array", maxItems: 4, items: { type: "string" } },
    validationRemaining: { type: "array", maxItems: 4, items: { type: "string" } },
    openQuestions: { type: "array", maxItems: 3, items: { type: "string" } },
    pullRequestTitle: { type: "string", maxLength: 120 },
    issuePolish: {
      type: "object",
      additionalProperties: false,
      required: ["needed", "title", "body", "reason"],
      properties: {
        needed: { type: "boolean" },
        title: { type: "string" },
        body: { type: "string" },
        reason: { type: "string" },
      },
    },
  },
} as const;

const AI_NOTICE = "**AI notice:** Generated with AI assistance and not guaranteed accurate. Verify findings and plans against the current source and runtime.";

export function parseArtifact(value: string): DiffuinArtifact {
  return artifactSchema.parse(JSON.parse(value));
}

export function renderArtifact(
  artifact: DiffuinArtifact,
  route: ExecutionRoute,
  metadata: { threadId: string; elapsedSeconds: number },
): { body: string; inlineComments: Array<{ path: string; line: number; body: string }> } {
  const inlineComments = artifact.findings
    .filter((finding) => finding.path && finding.line > 0)
    .map((finding) => ({
      path: finding.path,
      line: finding.line,
      body: `### [${finding.severity}] ${finding.title}\n\n${finding.body}\n\n**Recommended change:** ${finding.recommendation}`,
    }));

  const content = artifact.kind === "plan"
    ? renderPlan(artifact)
    : artifact.kind === "review"
      ? renderReview(artifact)
      : renderResponse(artifact, route);
  return { body: `${content}\n\n${renderMetadata(route, metadata)}\n\n---\n${AI_NOTICE}`, inlineComments };
}

export function renderInlineFallback(
  comments: Array<{ path: string; line: number; body: string }>,
): string {
  if (!comments.length) return "";
  return `\n\n### Findings that could not be placed inline\n\n${comments.map((comment) =>
    `**\`${comment.path}:${comment.line}\`**\n\n${comment.body}`
  ).join("\n\n---\n\n")}`;
}

function renderReview(artifact: DiffuinArtifact): string {
  const counts = ["P0", "P1", "P2"]
    .map((severity) => [severity, artifact.findings.filter((finding) => finding.severity === severity).length] as const)
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => `${count} ${severity}`)
    .join(", ") || "none";
  const findings = artifact.findings.length
    ? `\n\n### Findings\n\n${artifact.findings.map((finding) => {
      const location = finding.path ? ` — \`${finding.path}${finding.line > 0 ? `:${finding.line}` : ""}\`` : "";
      return `- **${finding.severity}: ${finding.title}**${location}`;
    }).join("\n")}`
    : "\n\nNo actionable findings.";
  const unplaced = artifact.findings.filter((finding) => !finding.path || finding.line <= 0);
  const unplacedDetails = unplaced.length
    ? `\n\n### Unplaced findings\n\n${unplaced.map((finding) =>
      `#### [${finding.severity}] ${finding.title}\n\n${finding.body}\n\n**Recommended change:** ${finding.recommendation}`
    ).join("\n\n")}`
    : "";
  return `## Diffuin review\n\n**Verdict:** ${label(artifact.verdict)}  \n**Confidence:** ${label(artifact.confidence)}  \n**Findings:** ${counts}\n\n${artifact.summary}${findings}${unplacedDetails}${renderEvidenceAndValidation(artifact)}`;
}

function renderPlan(artifact: DiffuinArtifact): string {
  const choices = section("Design decisions", artifact.designChoices, true);
  const phases = artifact.phases.length
    ? `\n\n### Implementation\n\n${artifact.phases.map((phase, index) => {
      const tasks = phase.tasks.map((task) => {
        const files = task.files.length ? ` (${task.files.map((file) => `\`${file}\``).join(", ")})` : "";
        return `   - ${task.description}${files}`;
      }).join("\n");
      return `${index + 1}. **${phase.title}** — ${phase.objective}${tasks ? `\n${tasks}` : ""}`;
    }).join("\n")}`
    : "";
  const questions = section("Implementation gates", artifact.openQuestions);
  return `## Implementation plan\n\n### Summary\n\n${artifact.summary}${choices}${phases}${questions}${renderEvidenceAndValidation(artifact)}`;
}

function renderResponse(artifact: DiffuinArtifact, route: ExecutionRoute): string {
  const title = route.mode === "investigate" ? "Issue investigation" : "Diffuin response";
  const recommendations = section("Recommended next steps", artifact.designChoices, true);
  const questions = section("Open questions", artifact.openQuestions);
  return `## ${title}\n\n**Confidence:** ${label(artifact.confidence)}\n\n${artifact.summary}${recommendations}${questions}${renderEvidenceAndValidation(artifact)}`;
}

function renderEvidenceAndValidation(artifact: DiffuinArtifact): string {
  const content = `${section("Evidence inspected", artifact.evidence)}${renderValidation(artifact)}`.trim();
  return content ? `\n\n<details>\n<summary>Evidence and validation</summary>\n\n${content}\n\n</details>` : "";
}

function renderValidation(artifact: DiffuinArtifact): string {
  return `${section("Validation performed", artifact.validationPerformed)}${section("Runtime validation remaining", artifact.validationRemaining)}`;
}

function section(title: string, values: string[], numbered = false): string {
  if (!values.length) return "";
  return `\n\n### ${title}\n\n${values.map((value, index) => numbered ? `${index + 1}. ${value}` : `- ${value}`).join("\n")}`;
}

function renderMetadata(route: ExecutionRoute, metadata: { threadId: string; elapsedSeconds: number }): string {
  return `<details>\n<summary>Diffuin run details</summary>\n\n- Model: \`${route.model}\`\n- Reasoning: \`${route.reasoningEffort}\` (${route.reason})\n- Elapsed: ${metadata.elapsedSeconds}s\n- Codex thread: \`${metadata.threadId}\`\n\n</details>`;
}

function label(value: string): string {
  return value.split("_").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ");
}
