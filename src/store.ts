import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Job, WorkRequest } from "./types.js";

interface JobRow {
  id: string;
  delivery_id: string;
  installation_id: number;
  repository_id: number;
  repository: string;
  owner: string;
  repo: string;
  issue_number: number;
  comment_id: number;
  actor: string;
  kind: Job["kind"];
  task: string;
  task_mode: Job["mode"];
  requested_model: string | null;
  requested_reasoning_effort: Job["requestedReasoningEffort"] | null;
  close_issue_on_merge: number;
  status: Job["status"];
  created_at: string;
  updated_at: string;
  error: string | null;
}

export class JobStore {
  private readonly database: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path);
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL UNIQUE,
        installation_id INTEGER NOT NULL,
        repository_id INTEGER NOT NULL,
        repository TEXT NOT NULL,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        issue_number INTEGER NOT NULL,
        comment_id INTEGER NOT NULL,
        actor TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('issue', 'pull_request')),
        task TEXT NOT NULL,
        task_mode TEXT NOT NULL DEFAULT 'auto',
        requested_model TEXT,
        requested_reasoning_effort TEXT,
        close_issue_on_merge INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status, created_at);
    `);
    this.ensureColumn("task_mode", "TEXT NOT NULL DEFAULT 'auto'");
    this.ensureColumn("requested_model", "TEXT");
    this.ensureColumn("requested_reasoning_effort", "TEXT");
    this.ensureColumn("close_issue_on_merge", "INTEGER NOT NULL DEFAULT 0");
  }

  enqueue(request: WorkRequest): Job | null {
    const now = new Date().toISOString();
    const job: Job = { ...request, id: randomUUID(), status: "queued", createdAt: now, updatedAt: now };
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO jobs (
        id, delivery_id, installation_id, repository_id, repository, owner, repo,
        issue_number, comment_id, actor, kind, task, task_mode, requested_model,
        requested_reasoning_effort, close_issue_on_merge, status, created_at, updated_at
      ) VALUES (
        @id, @deliveryId, @installationId, @repositoryId, @repository, @owner, @repo,
        @issueNumber, @commentId, @actor, @kind, @task, @mode, @requestedModel,
        @requestedReasoningEffort, @closeIssueOnMerge, @status, @createdAt, @updatedAt
      )
    `).run({
      ...job,
      requestedModel: job.requestedModel ?? null,
      requestedReasoningEffort: job.requestedReasoningEffort ?? null,
      closeIssueOnMerge: job.closeIssueOnMerge ? 1 : 0,
    });
    return result.changes === 1 ? job : null;
  }

  claimNext(): Job | null {
    return this.database.transaction(() => {
      const row = this.database.prepare(
        "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1",
      ).get() as JobRow | undefined;
      if (!row) {
        return null;
      }

      const now = new Date().toISOString();
      this.database.prepare(
        "UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'",
      ).run(now, row.id);
      return this.get(row.id);
    })();
  }

  finish(id: string, status: "succeeded" | "failed", error?: string): void {
    this.database.prepare(
      "UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?",
    ).run(status, error ?? null, new Date().toISOString(), id);
  }

  get(id: string): Job | null {
    const row = this.database.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? mapRow(row) : null;
  }

  recoverInterrupted(): number {
    return this.database.prepare(
      "UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'running'",
    ).run(new Date().toISOString()).changes;
  }

  close(): void {
    this.database.close();
  }

  private ensureColumn(name: string, definition: string): void {
    const columns = this.database.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === name)) {
      this.database.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${definition}`);
    }
  }
}

function mapRow(row: JobRow): Job {
  return {
    id: row.id,
    deliveryId: row.delivery_id,
    installationId: row.installation_id,
    repositoryId: row.repository_id,
    repository: row.repository,
    owner: row.owner,
    repo: row.repo,
    issueNumber: row.issue_number,
    commentId: row.comment_id,
    actor: row.actor,
    kind: row.kind,
    task: row.task,
    mode: row.task_mode ?? "auto",
    closeIssueOnMerge: row.close_issue_on_merge === 1,
    ...(row.requested_model ? { requestedModel: row.requested_model } : {}),
    ...(row.requested_reasoning_effort ? { requestedReasoningEffort: row.requested_reasoning_effort } : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.error ? { error: row.error } : {}),
  };
}
