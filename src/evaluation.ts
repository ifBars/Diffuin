import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type EvaluationSplit = "train" | "validation" | "holdout";

export function evaluationSplit(jobId: string): EvaluationSplit {
  const bucket = createHash("sha256").update(jobId).digest()[0]!;
  if (bucket < 128) return "train";
  if (bucket < 192) return "validation";
  return "holdout";
}

export function exportLearningEvaluation(databaseArgument: string, outputArgument: string): number {
  const databasePath = resolve(databaseArgument);
  const outputPath = resolve(outputArgument);
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  const rows = database.prepare(`
    SELECT
      jobs.id AS job_id,
      jobs.repository,
      jobs.issue_number,
      jobs.kind AS trigger_kind,
      jobs.task,
      jobs.task_mode,
      jobs.status,
      artifacts.source_sha,
      artifacts.artifact_json,
      artifacts.provider,
      artifacts.model,
      artifacts.reasoning_effort,
      artifacts.profile_id,
      artifacts.thread_id,
      artifacts.created_at
    FROM run_artifacts artifacts
    JOIN jobs ON jobs.id = artifacts.job_id
    ORDER BY artifacts.created_at, jobs.id
  `).all() as Array<Record<string, unknown> & { job_id: string; artifact_json: string }>;
  const findings = database.prepare(`
    SELECT
      delivered_findings.*,
      COALESCE(SUM(CASE WHEN feedback_events.signal = 'positive' AND feedback_events.operation = 'add' THEN 1
                        WHEN feedback_events.signal = 'positive' AND feedback_events.operation = 'remove' THEN -1 ELSE 0 END), 0) AS positive_score,
      COALESCE(SUM(CASE WHEN feedback_events.signal = 'negative' AND feedback_events.operation = 'add' THEN 1
                        WHEN feedback_events.signal = 'negative' AND feedback_events.operation = 'remove' THEN -1 ELSE 0 END), 0) AS negative_score,
      (SELECT COUNT(*) FROM finding_reactions
       WHERE finding_reactions.external_comment_id = delivered_findings.external_comment_id
         AND finding_reactions.signal = 'positive') AS positive_reactions,
      (SELECT COUNT(*) FROM finding_reactions
       WHERE finding_reactions.external_comment_id = delivered_findings.external_comment_id
         AND finding_reactions.signal = 'negative') AS negative_reactions
    FROM delivered_findings
    LEFT JOIN feedback_events USING (external_comment_id)
    GROUP BY delivered_findings.id
    ORDER BY delivered_findings.created_at
  `).all() as Array<Record<string, unknown> & { job_id: string }>;
  const outcomes = database.prepare(`
    SELECT * FROM pull_request_outcomes ORDER BY created_at
  `).all() as Array<Record<string, unknown> & { job_id: string }>;
  const findingsByJob = groupByJob(findings);
  const outcomesByJob = groupByJob(outcomes);
  const records = rows.map((row) => {
    const { artifact_json, ...metadata } = row;
    return {
      split: evaluationSplit(row.job_id),
      ...metadata,
      artifact: JSON.parse(artifact_json),
      findings: findingsByJob.get(row.job_id) ?? [],
      outcomes: outcomesByJob.get(row.job_id) ?? [],
    };
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""), "utf8");
  database.close();
  return records.length;
}

function groupByJob<T extends { job_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const group = grouped.get(row.job_id) ?? [];
    group.push(row);
    grouped.set(row.job_id, group);
  }
  return grouped;
}
