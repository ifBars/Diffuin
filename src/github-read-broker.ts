import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { z } from "zod";
import type {
  GitHubReadBrokerPort,
  GitHubReadSession,
  GitHubReadSource,
  IssueContext,
  WorkRequest,
} from "./types.js";

const SESSION_LIFETIME_MS = 30 * 60 * 1000;
const MAX_REPOSITORIES = 8;
const MAX_TOOL_RESPONSE = 150_000;

interface ActiveSession {
  request: WorkRequest;
  repositories: ReadonlySet<string>;
  expiresAt: number;
}

export class GitHubReadBroker implements GitHubReadBrokerPort {
  private readonly sessions = new Map<string, ActiveSession>();
  private server: Server | null = null;
  private endpoint: string | null = null;

  constructor(private readonly source: GitHubReadSource) {}

  async start(): Promise<void> {
    if (this.server) return;
    const app = createMcpExpressApp({ host: "127.0.0.1" });
    app.post("/mcp", (request, response) => void this.handle(request, response));
    app.all("/mcp", (_request, response) => {
      response.status(405).json({ error: "Only MCP POST requests are accepted" });
    });
    this.server = await new Promise<Server>((resolve, reject) => {
      const server = app.listen(0, "127.0.0.1", () => resolve(server));
      server.once("error", reject);
    });
    const address = this.server.address();
    if (!address || typeof address === "string") {
      await this.stop();
      throw new Error("GitHub read broker did not bind a TCP port");
    }
    this.endpoint = `http://127.0.0.1:${address.port}/mcp`;
  }

  async stop(): Promise<void> {
    this.sessions.clear();
    const server = this.server;
    this.server = null;
    this.endpoint = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  openSession(
    request: WorkRequest,
    context: IssueContext,
    repositoryGuidance: readonly string[] = [],
  ): GitHubReadSession {
    if (!this.endpoint) throw new Error("GitHub read broker has not started");
    this.removeExpiredSessions();
    const repositories = discoverMentionedRepositories(request, context, repositoryGuidance);
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, {
      request,
      repositories: new Set(repositories.map((repository) => repository.toLowerCase())),
      expiresAt: Date.now() + SESSION_LIFETIME_MS,
    });
    let closed = false;
    return {
      url: this.endpoint,
      token,
      repositories,
      close: () => {
        if (closed) return;
        closed = true;
        this.sessions.delete(token);
      },
    };
  }

  private async handle(request: Request, response: Response): Promise<void> {
    const token = bearerToken(request.get("authorization"));
    const session = token ? this.findSession(token) : undefined;
    if (!session) {
      response.status(401).json({ error: "Missing, invalid, or expired GitHub read session" });
      return;
    }

    const server = this.createMcpServer(session);
    const transport = new StreamableHTTPServerTransport();
    try {
      // MCP SDK 1.30's transport declarations conflict with exactOptionalPropertyTypes,
      // although the runtime class implements the required transport contract.
      await server.connect(transport as unknown as Parameters<McpServer["connect"]>[0]);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (!response.headersSent) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  }

  private createMcpServer(session: ActiveSession): McpServer {
    const server = new McpServer({ name: "diffuin-github-read", version: "1.0.0" });
    const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

    server.registerTool("github_get_repository", {
      description: "Read metadata for an allowed GitHub repository.",
      inputSchema: { repository: repositorySchema },
      annotations,
    }, async ({ repository }) => this.toolResult(await this.call(session, repository, () =>
      this.source.readRepository(session.request, repository))));

    server.registerTool("github_get_file", {
      description: "Read a text file or directory listing from an allowed GitHub repository.",
      inputSchema: {
        repository: repositorySchema,
        path: z.string().min(1).max(1_000),
        ref: z.string().min(1).max(250).optional(),
      },
      annotations,
    }, async ({ repository, path, ref }) => this.toolResult(await this.call(session, repository, () =>
      this.source.readFile(session.request, repository, path, ref))));

    server.registerTool("github_search_code", {
      description: "Search code within one allowed GitHub repository. The repository scope is enforced by the broker.",
      inputSchema: { repository: repositorySchema, query: z.string().min(2).max(300) },
      annotations,
    }, async ({ repository, query }) => this.toolResult(await this.call(session, repository, () =>
      this.source.searchCode(session.request, repository, query))));

    server.registerTool("github_get_issue", {
      description: "Read an issue and its recent comments from an allowed GitHub repository.",
      inputSchema: { repository: repositorySchema, number: z.number().int().positive() },
      annotations,
    }, async ({ repository, number }) => this.toolResult(await this.call(session, repository, () =>
      this.source.readIssue(session.request, repository, number))));

    server.registerTool("github_get_pull_request", {
      description: "Read pull request metadata, changed files, patches, and comments from an allowed GitHub repository.",
      inputSchema: { repository: repositorySchema, number: z.number().int().positive() },
      annotations,
    }, async ({ repository, number }) => this.toolResult(await this.call(session, repository, () =>
      this.source.readPullRequest(session.request, repository, number))));

    return server;
  }

  private async call(session: ActiveSession, repository: string, operation: () => Promise<unknown>): Promise<unknown> {
    if (Date.now() >= session.expiresAt) throw new Error("GitHub read session expired");
    if (!session.repositories.has(repository.toLowerCase())) {
      throw new Error(`Repository ${repository} was not mentioned in this task`);
    }
    return operation();
  }

  private toolResult(value: unknown) {
    return { content: [{ type: "text" as const, text: boundedJson(value) }] };
  }

  private findSession(token: string): ActiveSession | undefined {
    for (const [candidate, session] of this.sessions) {
      if (secureEqual(candidate, token)) {
        if (Date.now() >= session.expiresAt) {
          this.sessions.delete(candidate);
          return undefined;
        }
        return session;
      }
    }
    return undefined;
  }

  private removeExpiredSessions(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (now >= session.expiresAt) this.sessions.delete(token);
    }
  }
}

const repositorySchema = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);

export function discoverMentionedRepositories(
  request: WorkRequest,
  context: IssueContext,
  repositoryGuidance: readonly string[] = [],
): string[] {
  const repositories = new Map<string, string>();
  addRepository(repositories, request.repository);
  const texts = [request.task, context.body ?? "", ...(context.comments ?? []).map((comment) => comment.body)];
  for (const value of texts) {
    addGitHubLinks(repositories, value);
  }
  for (const match of request.task.matchAll(/(?:^|[\s(`])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?=$|[\s),`])/g)) {
    addRepository(repositories, match[1]!);
  }
  for (const value of repositoryGuidance) {
    addGitHubLinks(repositories, value);
  }
  return [...repositories.values()].slice(0, MAX_REPOSITORIES);
}

function addGitHubLinks(repositories: Map<string, string>, value: string): void {
  for (const match of value.matchAll(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?=[/#?\s)]|$)/gi)) {
    addRepository(repositories, `${match[1]}/${match[2]!.replace(/\.git$/i, "")}`);
  }
}

function addRepository(repositories: Map<string, string>, repository: string): void {
  repository = repository.replace(/[.,;:!?]+$/, "");
  if (!repositorySchema.safeParse(repository).success) return;
  const normalized = repository.replace(/\.git$/i, "");
  repositories.set(normalized.toLowerCase(), normalized);
}

function bearerToken(authorization: string | undefined): string | undefined {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match?.[1];
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function boundedJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized.length <= MAX_TOOL_RESPONSE) return serialized;
  return `${serialized.slice(0, MAX_TOOL_RESPONSE)}\n\n[GitHub response truncated by Diffuin.]`;
}
