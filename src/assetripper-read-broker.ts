import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import type { Server } from "node:http";
import { opendir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { z } from "zod";
import { sanitizedEnvironment } from "./environment.js";
import type { AssetRipperReadBrokerPort, AssetRipperReadSession } from "./types.js";

const SESSION_LIFETIME_MS = 30 * 60 * 1000;
const MAX_TOOL_RESPONSE = 150_000;
const MAX_READ_LINES = 400;
const MAX_SEARCH_MATCHES = 100;
const SEARCH_TIMEOUT_MS = 20_000;

interface ActiveSession {
  root: string;
  expiresAt: number;
}

interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export class AssetRipperReadBroker implements AssetRipperReadBrokerPort {
  private readonly sessions = new Map<string, ActiveSession>();
  private server: Server | null = null;
  private endpoint: string | null = null;

  async start(): Promise<void> {
    if (this.server) return;
    const app = createMcpExpressApp({ host: "127.0.0.1" });
    app.post("/mcp", (request, response) => void this.handle(request, response));
    app.all("/mcp", (_request, response) => {
      response.status(405).json({ error: "Only MCP POST requests are accepted" });
    });
    this.server = await new Promise<Server>((resolveServer, reject) => {
      const server = app.listen(0, "127.0.0.1", () => resolveServer(server));
      server.once("error", reject);
    });
    const address = this.server.address();
    if (!address || typeof address === "string") {
      await this.stop();
      throw new Error("AssetRipper read broker did not bind a TCP port");
    }
    this.endpoint = `http://127.0.0.1:${address.port}/mcp`;
  }

  async stop(): Promise<void> {
    this.sessions.clear();
    const server = this.server;
    this.server = null;
    this.endpoint = null;
    if (!server) return;
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }

  async openSession(root: string | undefined): Promise<AssetRipperReadSession | undefined> {
    if (!root) return undefined;
    if (!this.endpoint) throw new Error("AssetRipper read broker has not started");
    this.removeExpiredSessions();
    const canonicalRoot = await realpath(root);
    const info = await stat(canonicalRoot);
    if (!info.isDirectory()) throw new Error(`AssetRipper corpus is not a directory: ${root}`);

    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, { root: canonicalRoot, expiresAt: Date.now() + SESSION_LIFETIME_MS });
    let closed = false;
    return {
      url: this.endpoint,
      token,
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
      response.status(401).json({ error: "Missing, invalid, or expired AssetRipper read session" });
      return;
    }

    const server = this.createMcpServer(session);
    const transport = new StreamableHTTPServerTransport();
    try {
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
    const server = new McpServer({ name: "diffuin-assetripper-read", version: "1.0.0" });
    const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

    server.registerTool("assetripper_find_paths", {
      description: "Find AssetRipper corpus paths by case-insensitive filename or path substring.",
      inputSchema: {
        query: searchQuerySchema,
        path: relativePathSchema.optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations,
    }, async ({ query, path, limit }) => this.toolResult(await findPaths(session.root, query, path, limit)));

    server.registerTool("assetripper_list_directory", {
      description: "List one directory in the private AssetRipper corpus.",
      inputSchema: { path: relativePathSchema.optional() },
      annotations,
    }, async ({ path }) => this.toolResult(await listDirectory(session.root, path)));

    server.registerTool("assetripper_search", {
      description: "Search private AssetRipper YAML and text evidence with a fixed-string query.",
      inputSchema: {
        query: searchQuerySchema,
        path: relativePathSchema.optional(),
        extensions: z.array(z.string().regex(/^\.[A-Za-z0-9]+$/)).max(12).optional(),
        limit: z.number().int().min(1).max(MAX_SEARCH_MATCHES).default(50),
      },
      annotations,
    }, async ({ query, path, extensions, limit }) => this.toolResult(
      await searchCorpus(session.root, query, path, extensions, limit),
    ));

    server.registerTool("assetripper_read_file", {
      description: "Read a bounded line range from one text file in the private AssetRipper corpus.",
      inputSchema: {
        path: relativePathSchema,
        startLine: z.number().int().min(1).default(1),
        endLine: z.number().int().min(1).optional(),
      },
      annotations,
    }, async ({ path, startLine, endLine }) => this.toolResult(
      await readTextRange(session.root, path, startLine, endLine),
    ));

    return server;
  }

  private toolResult(value: unknown) {
    return { content: [{ type: "text" as const, text: boundedJson(value) }] };
  }

  private findSession(token: string): ActiveSession | undefined {
    for (const [candidate, session] of this.sessions) {
      if (!secureEqual(candidate, token)) continue;
      if (Date.now() >= session.expiresAt) {
        this.sessions.delete(candidate);
        return undefined;
      }
      return session;
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

const relativePathSchema = z.string().max(1_000).refine(
  (value) => !/[\0\r\n]/.test(value) && !isAbsolute(value) && !value.split(/[\\/]+/).includes(".."),
  "Path must stay within the AssetRipper corpus",
);
const searchQuerySchema = z.string().min(2).max(300).refine(
  (value) => !/[\0\r\n]/.test(value),
  "Search query must be a single line",
);

async function findPaths(root: string, query: string, path: string | undefined, limit: number) {
  const start = await containedPath(root, path, true);
  const lowered = query.toLowerCase();
  const matches: string[] = [];
  let truncated = false;

  async function visit(directory: string): Promise<void> {
    const entries = await opendir(directory);
    for await (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = resolve(directory, entry.name);
      const candidate = toRelativePath(root, absolute);
      if (candidate.toLowerCase().includes(lowered)) {
        if (matches.length >= limit) {
          truncated = true;
          return;
        }
        matches.push(candidate);
      }
      if (entry.isDirectory()) {
        await visit(absolute);
        if (truncated) return;
      }
    }
  }

  const info = await stat(start);
  if (info.isDirectory()) await visit(start);
  else if (toRelativePath(root, start).toLowerCase().includes(lowered)) matches.push(toRelativePath(root, start));
  return { matches, truncated };
}

async function listDirectory(root: string, path: string | undefined) {
  const directory = await containedPath(root, path, true);
  const info = await stat(directory);
  if (!info.isDirectory()) throw new Error(`Not a directory: ${path ?? "."}`);
  const entries = [];
  const handle = await opendir(directory);
  for await (const entry of handle) {
    if (entry.isSymbolicLink()) continue;
    entries.push({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" });
    if (entries.length >= 500) break;
  }
  entries.sort((left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name));
  return { path: path ?? ".", entries, truncated: entries.length >= 500 };
}

async function searchCorpus(
  root: string,
  query: string,
  path: string | undefined,
  extensions: string[] | undefined,
  limit: number,
): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  const searchRoot = await containedPath(root, path, true);
  const args = [
    "--fixed-strings",
    "--line-number",
    "--column",
    "--no-heading",
    "--color",
    "never",
    "--max-columns",
    "1000",
    "--max-columns-preview",
    "--max-count",
    "5",
  ];
  for (const extension of extensions ?? []) args.push("--glob", `*${extension}`);
  args.push("--", query, searchRoot);

  return new Promise((resolveSearch, reject) => {
    const child = spawn("rg", args, { env: sanitizedEnvironment(), windowsHide: true });
    const matches: SearchMatch[] = [];
    let pending = "";
    let stderr = "";
    let truncated = false;
    let settled = false;
    const timer = setTimeout(() => {
      truncated = true;
      child.kill();
    }, SEARCH_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const match = parseSearchLine(root, line);
        if (match) matches.push(match);
        if (matches.length >= limit) {
          truncated = true;
          child.kill();
          break;
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2_000);
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => {
      if (pending && matches.length < limit) {
        const match = parseSearchLine(root, pending);
        if (match) matches.push(match);
      }
      if (code !== 0 && code !== 1 && !truncated) {
        reject(new Error(`AssetRipper search failed: ${stderr.trim() || `rg exited with code ${code}`}`));
        return;
      }
      resolveSearch({ matches: matches.slice(0, limit), truncated });
    }));

    function finish(operation: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation();
    }
  });
}

function parseSearchLine(root: string, line: string): SearchMatch | undefined {
  const match = line.match(/^(.*?):(\d+):(\d+):(.*)$/);
  if (!match) return undefined;
  const [, absolutePath, lineNumber, column, text] = match;
  if (!absolutePath || !lineNumber || !column || text === undefined) return undefined;
  return {
    path: toRelativePath(root, absolutePath),
    line: Number(lineNumber),
    column: Number(column),
    text,
  };
}

async function readTextRange(
  root: string,
  path: string,
  startLine: number,
  requestedEndLine: number | undefined,
) {
  const file = await containedPath(root, path, false);
  const info = await stat(file);
  if (!info.isFile()) throw new Error(`Not a file: ${path}`);
  const endLine = Math.min(requestedEndLine ?? startLine + MAX_READ_LINES - 1, startLine + MAX_READ_LINES - 1);
  if (endLine < startLine) throw new Error("endLine must be greater than or equal to startLine");

  const lines: string[] = [];
  let currentLine = 0;
  let characterCount = 0;
  let truncated = false;
  const input = createReadStream(file, { encoding: "utf8" });
  const reader = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      currentLine += 1;
      if (currentLine < startLine) continue;
      if (currentLine > endLine) {
        truncated = true;
        break;
      }
      if (line.includes("\0")) throw new Error(`Refusing to read binary file: ${path}`);
      lines.push(line);
      characterCount += line.length + 1;
      if (characterCount >= MAX_TOOL_RESPONSE) {
        truncated = true;
        break;
      }
    }
  } finally {
    reader.close();
    input.destroy();
  }
  return {
    path: toRelativePath(root, file),
    startLine,
    endLine: startLine + Math.max(0, lines.length - 1),
    content: lines.join("\n"),
    truncated,
  };
}

async function containedPath(root: string, path: string | undefined, allowRoot: boolean): Promise<string> {
  const candidate = resolve(root, path || ".");
  const canonical = await realpath(candidate);
  if ((!allowRoot && canonical === root) || (canonical !== root && !canonical.startsWith(`${root}${sep}`))) {
    throw new Error("Path escapes the AssetRipper corpus");
  }
  return canonical;
}

function toRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function bearerToken(authorization: string | undefined): string | undefined {
  return authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function boundedJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized.length <= MAX_TOOL_RESPONSE) return serialized;
  return `${serialized.slice(0, MAX_TOOL_RESPONSE)}\n\n[AssetRipper response truncated by Diffuin.]`;
}
