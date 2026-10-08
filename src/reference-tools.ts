import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizedEnvironment } from "./environment.js";
import type { ReferenceSnapshot } from "./types.js";

const execFileAsync = promisify(execFile);
const hash = z.string().regex(/^[a-f0-9]{7,40}$/);
const filePath = z.string().min(1).max(500).refine((value) =>
  !isAbsolute(value) && !value.includes("\\") && !value.includes(":") &&
  !value.split("/").some((part) => !part || part === ".." || part === "."));

export class ReferenceEvidence {
  private static decompiling = false;
  constructor(private readonly snapshots: readonly ReferenceSnapshot[]) {}

  status() {
    return this.snapshots.map(({ path: _path, ...metadata }) => metadata);
  }

  private find(id: string): ReferenceSnapshot {
    const snapshot = this.snapshots.find((entry) => entry.id === id);
    if (!snapshot) throw new Error("Reference is unavailable or not authorized for this job");
    return snapshot;
  }

  private async revision(snapshot: ReferenceSnapshot, value?: string): Promise<string> {
    if (!value) return snapshot.revision;
    hash.parse(value);
    // Permit only commits within this snapshot's bounded branch history.
    const commits = await this.git(snapshot, ["rev-list", `--max-count=${snapshot.depth}`, snapshot.revision]);
    const matches = commits.trim().split("\n").filter((commit) => commit.startsWith(value));
    if (matches.length !== 1) throw new Error("Revision is outside the available reference history or is ambiguous");
    return matches[0]!;
  }

  async history(id: string) {
    const snapshot = this.find(id);
    return this.git(snapshot, ["log", `--max-count=${snapshot.depth}`, "--format=%H %cI %s", snapshot.revision]);
  }

  async files(id: string, revision?: string) {
    const snapshot = this.find(id);
    return this.git(snapshot, ["ls-tree", "-r", "--name-only", await this.revision(snapshot, revision), "--", ...snapshot.paths]);
  }

  async read(id: string, path: string, revision?: string) {
    const snapshot = this.find(id);
    assertEvidencePath(snapshot, path);
    if (!/\.(cs|md|json|props|targets|txt|yml|yaml|xml)$/i.test(path)) {
      throw new Error("Only source and documentation text can be read; use decompile_type for assemblies");
    }
    return this.git(snapshot, ["show", `${await this.revision(snapshot, revision)}:${path}`]);
  }

  async diff(id: string, before: string, after: string, path: string) {
    const snapshot = this.find(id);
    assertEvidencePath(snapshot, path);
    return this.git(snapshot, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=3",
      await this.revision(snapshot, before), await this.revision(snapshot, after), "--", path]);
  }

  async decompile(id: string, path: string, type: string) {
    const snapshot = this.find(id);
    assertEvidencePath(snapshot, path);
    if (!path.endsWith(".dll")) throw new Error("Only DLL metadata may be decompiled");
    z.string().regex(/^[A-Za-z_][A-Za-z0-9_.+`]{0,250}$/).parse(type);
    const root = await realpath(snapshot.path);
    const assembly = await realpath(resolve(root, path));
    const child = relative(root, assembly);
    if (!child || isAbsolute(child) || child === ".." || child.startsWith("../") || child.startsWith("..\\")) {
      throw new Error("Assembly resolves outside its reference");
    }
    // Metadata inspection only: never execute or load game code into a game runtime.
    if (ReferenceEvidence.decompiling) throw new Error("Another focused decompilation is running; retry after it completes");
    ReferenceEvidence.decompiling = true;
    try {
      const result = await execFileAsync("ilspycmd", ["--disable-updatecheck", "-t", type, "-r", dirname(assembly), assembly], {
        cwd: root,
        env: sanitizedEnvironment({
          DOTNET_ROOT: process.env.DOTNET_ROOT ?? "",
          DOTNET_GCHeapHardLimit: "08000000",
          DOTNET_CLI_TELEMETRY_OPTOUT: "1",
          DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1",
        }),
        encoding: "utf8", timeout: 20_000, maxBuffer: 512 * 1024,
      });
      return {
        revision: snapshot.revision, runtime: snapshot.runtime, type,
        limitation: snapshot.runtime === "il2cpp"
          ? "Generated managed wrapper shape only; these bodies are not native IL2CPP game implementations."
          : "Static managed-code evidence; not gameplay validation.",
        text: result.stdout.slice(0, 100_000), truncated: result.stdout.length > 100_000,
      };
    } catch {
      throw new Error("Focused decompilation failed or exceeded its resource limit; verify the type and ILSpy installation");
    } finally {
      ReferenceEvidence.decompiling = false;
    }
  }

  private async git(snapshot: ReferenceSnapshot, args: string[]): Promise<string> {
    try {
      const result = await execFileAsync("git", args, {
        cwd: snapshot.path, env: sanitizedEnvironment({
          GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
          GIT_NO_LAZY_FETCH: "1",
        }), encoding: "utf8", timeout: 15_000, maxBuffer: 512 * 1024,
      });
      return result.stdout;
    } catch {
      throw new Error("Reference query failed or exceeded its response limit; narrow the file or comparison");
    }
  }
}

export function assertEvidencePath(snapshot: ReferenceSnapshot, path: string): void {
  filePath.parse(path);
  if (!snapshot.paths.some((root) => path === root || path.startsWith(`${root}/`))) {
    throw new Error("Path is outside the configured evidence directories");
  }
}

export function registerReferenceTools(server: McpServer, snapshots: readonly ReferenceSnapshot[]): void {
  if (snapshots.length === 0) return;
  const evidence = new ReferenceEvidence(snapshots);
  const id = z.string().max(64);
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const result = (value: unknown) => {
    const text = JSON.stringify(value);
    return { content: [{ type: "text" as const, text: text.length > 150_000
      ? JSON.stringify({ truncated: true, text: text.slice(0, 100_000), instruction: "Narrow the reference query." })
      : text }] };
  };
  server.registerTool("reference_status", {
    description: "List authorized cached references, refresh status, commit versions, and evidence limitations. Refreshed means latest upstream commit, not latest Steam build.",
    inputSchema: {}, annotations,
  }, async () => result(evidence.status()));
  server.registerTool("reference_history", {
    description: "Read recent commit history from an authorized reference. History is deliberately bounded.",
    inputSchema: { id }, annotations,
  }, async ({ id }) => result(await evidence.history(id)));
  server.registerTool("reference_files", {
    description: "List cached source or assembly paths at the pinned head or a commit in available history.",
    inputSchema: { id, revision: hash.optional() }, annotations,
  }, async ({ id, revision }) => result(await evidence.files(id, revision)));
  server.registerTool("reference_read", {
    description: "Read a focused source or documentation file from authorized cached evidence.",
    inputSchema: { id, path: filePath, revision: hash.optional() }, annotations,
  }, async ({ id, path, revision }) => result(await evidence.read(id, path, revision)));
  server.registerTool("reference_diff", {
    description: "Compare a focused path between two commits in cached reference history, offline.",
    inputSchema: { id, before: hash, after: hash, path: filePath }, annotations,
  }, async ({ id, before, after, path }) => result(await evidence.diff(id, before, after, path)));
  server.registerTool("reference_decompile_type", {
    description: "Inspect one fully qualified type from an authorized assembly using ILSpy, with bounded memory/time/output. Never executes game code. IL2CPP references expose managed wrappers, not native game method bodies.",
    inputSchema: { id, path: filePath, type: z.string().min(1).max(251) }, annotations,
  }, async ({ id, path, type }) => result(await evidence.decompile(id, path, type)));
}
