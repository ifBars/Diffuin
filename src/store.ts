import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DiffuinArtifact } from "./artifact.js";
import type { FeedbackEvent, Job, MemoryCommand, ProjectMemory, WorkRequest } from "./types.js";

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
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        repository_id INTEGER NOT NULL,
        repository TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('repository', 'path', 'user')),
        actor TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'precedent', 'warning')),
        text TEXT NOT NULL,
        rationale TEXT,
        path_glob TEXT,
        evidence_url TEXT NOT NULL,
        source_sha TEXT,
        status TEXT NOT NULL CHECK (status IN ('approved', 'rejected', 'stale', 'promoted')),
        created_at TEXT NOT NULL,
        last_verified_at TEXT
      );
      CREATE INDEX IF NOT EXISTS memories_repository_status ON memories(repository_id, status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS memories_evidence_url ON memories(evidence_url);
      CREATE TABLE IF NOT EXISTS run_artifacts (
        job_id TEXT PRIMARY KEY,
        repository_id INTEGER NOT NULL,
        issue_number INTEGER NOT NULL,
        source_sha TEXT NOT NULL,
        artifact_json TEXT NOT NULL,
        status_comment_id INTEGER,
        provider TEXT,
        model TEXT,
        reasoning_effort TEXT,
        profile_id TEXT,
        thread_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS delivered_findings (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        external_comment_id INTEGER NOT NULL UNIQUE,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        path TEXT NOT NULL,
        line INTEGER NOT NULL,
        body TEXT NOT NULL,
        recommendation TEXT NOT NULL,
        last_feedback_sync TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS delivered_findings_job ON delivered_findings(job_id);
      CREATE TABLE IF NOT EXISTS feedback_events (
        delivery_id TEXT PRIMARY KEY,
        repository_id INTEGER NOT NULL,
        repository TEXT NOT NULL,
        actor TEXT NOT NULL,
        external_comment_id INTEGER NOT NULL,
        signal TEXT NOT NULL CHECK (signal IN ('positive', 'negative')),
        operation TEXT NOT NULL CHECK (operation IN ('add', 'remove')),
        body TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS feedback_comment_created ON feedback_events(external_comment_id, created_at);
      CREATE TABLE IF NOT EXISTS finding_reactions (
        external_comment_id INTEGER NOT NULL,
        actor TEXT NOT NULL,
        signal TEXT NOT NULL CHECK (signal IN ('positive', 'negative')),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (external_comment_id, actor)
      );
      CREATE TABLE IF NOT EXISTS pull_request_outcomes (
        delivery_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        repository_id INTEGER NOT NULL,
        pull_request_number INTEGER NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('merged', 'closed')),
        commit_sha TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this.ensureColumn("task_mode", "TEXT NOT NULL DEFAULT 'auto'");
    this.ensureColumn("requested_model", "TEXT");
    this.ensureColumn("requested_reasoning_effort", "TEXT");
    this.ensureColumn("close_issue_on_merge", "INTEGER NOT NULL DEFAULT 0");
    this.ensureTableColumn("run_artifacts", "provider", "TEXT");
    this.ensureTableColumn("run_artifacts", "model", "TEXT");
    this.ensureTableColumn("run_artifacts", "reasoning_effort", "TEXT");
    this.ensureTableColumn("run_artifacts", "profile_id", "TEXT");
    this.ensureTableColumn("run_artifacts", "thread_id", "TEXT");
    this.ensureTableColumn("delivered_findings", "last_feedback_sync", "TEXT");
    this.ensureTableColumn("feedback_events", "body", "TEXT");
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

  remember(command: MemoryCommand): ProjectMemory {
    if (!command.memoryScope || !command.memoryKind || !command.memoryText) {
      throw new Error("Incomplete memory command");
    }
    const memory: ProjectMemory = {
      id: randomUUID(),
      repositoryId: command.repositoryId,
      repository: command.repository,
      scope: command.memoryScope,
      actor: command.actor,
      kind: command.memoryKind,
      text: command.memoryText,
      rationale: command.memoryRationale,
      pathGlob: command.memoryPathGlob,
      evidenceUrl: command.evidenceUrl,
      sourceSha: command.memorySourceSha,
      status: "approved",
      createdAt: new Date().toISOString(),
      lastVerifiedAt: command.memorySourceSha ? new Date().toISOString() : undefined,
    };
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO memories (
        id, repository_id, repository, scope, actor, kind, text, rationale,
        path_glob, evidence_url, source_sha, status, created_at, last_verified_at
      ) VALUES (
        @id, @repositoryId, @repository, @scope, @actor, @kind, @text, @rationale,
        @pathGlob, @evidenceUrl, @sourceSha, @status, @createdAt, @lastVerifiedAt
      )
    `).run({
      ...memory,
      rationale: memory.rationale ?? null,
      pathGlob: memory.pathGlob ?? null,
      sourceSha: memory.sourceSha ?? null,
      lastVerifiedAt: memory.lastVerifiedAt ?? null,
    });
    if (result.changes === 1) return memory;
    const existing = this.database.prepare("SELECT * FROM memories WHERE evidence_url = ?").get(command.evidenceUrl) as MemoryRow;
    return mapMemoryRow(existing);
  }

  forgetMemory(command: MemoryCommand): boolean {
    if (!command.memoryId) return false;
    const result = this.database.prepare(`
      UPDATE memories SET status = 'rejected'
      WHERE id = ? AND repository_id = ?
        AND (scope != 'user' OR lower(actor) = lower(?))
        AND status IN ('approved', 'promoted')
    `).run(command.memoryId, command.repositoryId, command.actor);
    return result.changes === 1;
  }

  listMemories(request: Pick<WorkRequest, "repositoryId" | "actor">): ProjectMemory[] {
    const rows = this.database.prepare(`
      SELECT * FROM memories
      WHERE repository_id = ? AND status IN ('approved', 'promoted')
        AND (scope != 'user' OR lower(actor) = lower(?))
      ORDER BY created_at DESC LIMIT 50
    `).all(request.repositoryId, request.actor) as MemoryRow[];
    return rows.map(mapMemoryRow);
  }

  listApplicableMemories(job: Job, paths: readonly string[], includeUser: boolean): ProjectMemory[] {
    return this.listMemories(job)
      .filter((memory) => includeUser || memory.scope !== "user")
      .filter((memory) => memory.scope !== "path" || paths.some((path) => pathMatches(memory.pathGlob ?? "", path)))
      .slice(0, 12);
  }

  saveArtifact(
    job: Job,
    artifact: DiffuinArtifact,
    sourceSha: string,
    statusCommentId: number | null,
    metadata: {
      provider?: string | undefined;
      model?: string | undefined;
      reasoningEffort?: string | undefined;
      profileId?: string | undefined;
      threadId?: string | undefined;
    } = {},
  ): void {
    this.database.prepare(`
      INSERT INTO run_artifacts (
        job_id, repository_id, issue_number, source_sha, artifact_json, status_comment_id,
        provider, model, reasoning_effort, profile_id, thread_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        source_sha = excluded.source_sha,
        artifact_json = excluded.artifact_json,
        status_comment_id = excluded.status_comment_id,
        provider = excluded.provider,
        model = excluded.model,
        reasoning_effort = excluded.reasoning_effort,
        profile_id = excluded.profile_id,
        thread_id = excluded.thread_id
    `).run(
      job.id,
      job.repositoryId,
      job.issueNumber,
      sourceSha,
      JSON.stringify(artifact),
      statusCommentId,
      metadata.provider ?? null,
      metadata.model ?? null,
      metadata.reasoningEffort ?? null,
      metadata.profileId ?? null,
      metadata.threadId ?? null,
      new Date().toISOString(),
    );
  }

  recordDeliveredFindings(jobId: string, artifact: DiffuinArtifact, externalCommentIds: readonly number[]): void {
    const findings = artifact.findings.filter((finding) => finding.path && finding.line > 0);
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO delivered_findings (
        id, job_id, external_comment_id, severity, title, path, line, body, recommendation,
        last_feedback_sync, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.database.transaction(() => {
      for (let index = 0; index < Math.min(findings.length, externalCommentIds.length); index += 1) {
        const finding = findings[index]!;
        insert.run(
          randomUUID(), jobId, externalCommentIds[index], finding.severity, finding.title,
          finding.path, finding.line, finding.body, finding.recommendation, null, new Date().toISOString(),
        );
      }
    })();
  }

  recordFeedback(event: FeedbackEvent): boolean {
    const known = this.database.prepare(
      "SELECT 1 FROM delivered_findings WHERE external_comment_id = ?",
    ).get(event.externalCommentId);
    if (!known) return false;
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO feedback_events (
        delivery_id, repository_id, repository, actor, external_comment_id, signal, operation, body, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.deliveryId,
      event.repositoryId,
      event.repository,
      event.actor,
      event.externalCommentId,
      event.signal,
      event.operation,
      event.body ?? null,
      new Date().toISOString(),
    );
    return result.changes === 1;
  }

  findingsForFeedbackSync(repositoryId: number, limit = 12): number[] {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const rows = this.database.prepare(`
      SELECT delivered_findings.external_comment_id
      FROM delivered_findings
      JOIN run_artifacts ON run_artifacts.job_id = delivered_findings.job_id
      WHERE run_artifacts.repository_id = ?
        AND (delivered_findings.last_feedback_sync IS NULL OR delivered_findings.last_feedback_sync < ?)
      ORDER BY delivered_findings.created_at DESC
      LIMIT ?
    `).all(repositoryId, cutoff, limit) as Array<{ external_comment_id: number }>;
    return rows.map((row) => row.external_comment_id);
  }

  replaceFindingReactions(
    externalCommentId: number,
    reactions: ReadonlyArray<{ actor: string; signal: "positive" | "negative" }>,
  ): void {
    const now = new Date().toISOString();
    const remove = this.database.prepare("DELETE FROM finding_reactions WHERE external_comment_id = ?");
    const insert = this.database.prepare(`
      INSERT INTO finding_reactions (external_comment_id, actor, signal, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    const mark = this.database.prepare(
      "UPDATE delivered_findings SET last_feedback_sync = ? WHERE external_comment_id = ?",
    );
    this.database.transaction(() => {
      remove.run(externalCommentId);
      for (const reaction of reactions) insert.run(externalCommentId, reaction.actor, reaction.signal, now);
      mark.run(now, externalCommentId);
    })();
  }

  recordPullRequestOutcome(input: {
    deliveryId: string;
    jobId: string;
    repositoryId: number;
    pullRequestNumber: number;
    outcome: "merged" | "closed";
    commitSha?: string | undefined;
  }): boolean {
    const known = this.database.prepare(
      "SELECT 1 FROM jobs WHERE id = ? AND repository_id = ?",
    ).get(input.jobId, input.repositoryId);
    if (!known) return false;
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO pull_request_outcomes (
        delivery_id, job_id, repository_id, pull_request_number, outcome, commit_sha, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.deliveryId,
      input.jobId,
      input.repositoryId,
      input.pullRequestNumber,
      input.outcome,
      input.commitSha ?? null,
      new Date().toISOString(),
    );
    return result.changes === 1;
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
    this.ensureTableColumn("jobs", name, definition);
  }

  private ensureTableColumn(table: string, name: string, definition: string): void {
    if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(name)) throw new Error("Invalid migration identifier");
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === name)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }
}

interface MemoryRow {
  id: string;
  repository_id: number;
  repository: string;
  scope: ProjectMemory["scope"];
  actor: string;
  kind: ProjectMemory["kind"];
  text: string;
  rationale: string | null;
  path_glob: string | null;
  evidence_url: string;
  source_sha: string | null;
  status: ProjectMemory["status"];
  created_at: string;
  last_verified_at: string | null;
}

function mapMemoryRow(row: MemoryRow): ProjectMemory {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    repository: row.repository,
    scope: row.scope,
    actor: row.actor,
    kind: row.kind,
    text: row.text,
    ...(row.rationale ? { rationale: row.rationale } : {}),
    ...(row.path_glob ? { pathGlob: row.path_glob } : {}),
    evidenceUrl: row.evidence_url,
    ...(row.source_sha ? { sourceSha: row.source_sha } : {}),
    status: row.status,
    createdAt: row.created_at,
    ...(row.last_verified_at ? { lastVerifiedAt: row.last_verified_at } : {}),
  };
}

function pathMatches(glob: string, path: string): boolean {
  const normalizedGlob = glob.replace(/\\/g, "/");
  const normalizedPath = path.replace(/\\/g, "/");
  if (normalizedGlob.endsWith("/**")) return normalizedPath.startsWith(normalizedGlob.slice(0, -3));
  const expression = normalizedGlob
    .replace(/[.+^$()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/__DOUBLE_STAR__/g, ".*");
  return new RegExp(`^${expression}$`, "i").test(normalizedPath);
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
