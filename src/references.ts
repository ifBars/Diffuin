import { execFile } from "node:child_process";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { sanitizedEnvironment } from "./environment.js";
import { gitAuthEnvironment } from "./git.js";
import type { ReferenceSource } from "./reference-catalog.js";
import type { ReferenceSnapshot, ScheduleOneReferences, WorkRequest } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 10 * 1024 * 1024;

export class ScheduleOneReferenceWorkspace {
  private readonly root: string;
  private readonly skillPath: string;
  private readonly assetRipperPath: string | undefined;

  constructor(
    dataDir: string,
    skillPath: string,
    private readonly codeArchiverUrl: string,
    assetRipperPath?: string,
    private readonly options: {
      sources?: readonly ReferenceSource[] | undefined;
      authorize?: ((request: WorkRequest, repository: string) => Promise<string>) | undefined;
    } = {},
  ) {
    this.root = resolve(dataDir, "references");
    this.skillPath = resolve(skillPath);
    this.assetRipperPath = assetRipperPath ? resolve(assetRipperPath) : undefined;
  }

  async prepare(request?: WorkRequest): Promise<ScheduleOneReferences> {
    await assertDirectory(this.skillPath, "Schedule One skill");
    await mkdir(this.root, { recursive: true });

    const warnings: string[] = [];
    const sources = this.options.sources ?? (["alternate", "alternate-beta"] as const).map((branch) => ({
      id: `s1-codearchiver-${branch}`, label: `${branch} stripped source`,
      repository: "k073l/s1-codearchiver", branch, paths: ["ScheduleOne-stripped"],
      depth: 12, access: "public" as const, runtime: "source" as const,
    }));
    const snapshots: ReferenceSnapshot[] = [];
    // Serial refresh avoids concurrent Git packs competing on the free VM.
    for (const source of sources) {
      let token: string | undefined;
      if (source.access === "installation") {
        try {
          if (!request || !this.options.authorize) throw new Error("No authorized reference session");
          token = await this.options.authorize(request, source.repository);
        } catch {
          warnings.push(`${source.label} unavailable: App installation and requesting actor must both have repository read access.`);
          continue;
        }
      }
      try {
        snapshots.push(await this.prepareSource(source, token, warnings));
      } catch {
        // Child-process errors can include credentials or remote-controlled output.
        warnings.push(`${source.label} unavailable: reference refresh failed; no verified snapshot is available.`);
      }
    }
    const sourcePath = (branch: string) => {
      const snapshot = snapshots.find((entry) => entry.runtime === "source" && entry.branch === branch);
      return snapshot ? join(snapshot.path, "ScheduleOne-stripped") : undefined;
    };
    const regularSourcePath = sourcePath("alternate");
    const betaSourcePath = sourcePath("alternate-beta");
    const assetRipperPath = await this.resolveAssetRipperPath(warnings);
    return {
      skillPath: this.skillPath,
      regularSourcePath,
      betaSourcePath,
      assetRipperPath,
      warnings,
      snapshots,
    };
  }

  private async prepareSource(source: ReferenceSource, token: string | undefined, warnings: string[]): Promise<ReferenceSnapshot> {
    const path = resolve(this.root, source.id);
    this.assertContained(path);
    const environment = token ? gitAuthEnvironment(token, this.root) : sanitizedEnvironment({
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
    });
    const url = source.repository === "k073l/s1-codearchiver"
      ? this.codeArchiverUrl : `https://github.com/${source.repository}.git`;
    let freshness: ReferenceSnapshot["freshness"] = "refreshed";
    let checkedAt = new Date().toISOString();
    const existed = await exists(join(path, ".git"));
    let previous: ReferenceSnapshot | undefined;
    if (existed) {
      previous = await this.snapshot(source, path, "stale", "").catch(() => undefined);
      // Never reuse a cache whose repository or branch changed in the catalog.
      const remote = await this.git(["remote", "get-url", "origin"], path, environment);
      if (remote.stdout.trim() !== url) throw new Error("Reference cache remote does not match its catalog entry");
      const fetchSpec = await this.git(["config", "--get", "remote.origin.fetch"], path, environment);
      if (!fetchSpec.stdout.includes(`refs/heads/${source.branch}:`)) {
        throw new Error("Reference cache branch does not match its catalog entry; use a new catalog ID");
      }
    }

    try {
      if (!existed) {
        if (await exists(path)) {
          await rm(path, { recursive: true, force: true, maxRetries: 3 });
        }
        await this.git([
          "clone", "--depth", String(source.depth), "--sparse",
          "--branch", source.branch, "--single-branch", url, path,
        ], this.root, environment);
      } else {
        // Upgrade old depth-one/promisor caches and hydrate history before the offline job.
        await this.git(["fetch", "--depth", String(source.depth), "--no-tags", "origin", source.branch], path, environment);
        await this.git(["checkout", "--detach", "--force", "FETCH_HEAD"], path, environment);
      }
      await this.git(["sparse-checkout", "set", "--cone", ...source.paths], path, environment);
      // Force historical blobs into old partial clones while credentials are present.
      if ((await this.git(["config", "--get", "remote.origin.promisor"], path, environment).catch(() => undefined))?.stdout.trim() === "true") {
        const commits = (await this.git(["rev-list", `--max-count=${source.depth}`, "HEAD"], path, environment)).stdout.trim().split("\n");
        for (const commit of commits) {
          const archivePath = join(this.root, `${source.id}-hydrate.tar`);
          try {
            await this.git(["archive", "--format=tar", `--output=${archivePath}`, commit, ...source.paths], path, environment);
          } finally {
            await rm(archivePath, { force: true });
          }
        }
        await this.git(["config", "--unset", "remote.origin.promisor"], path, environment);
        await this.git(["config", "--unset", "remote.origin.partialclonefilter"], path, environment).catch(() => undefined);
      }
      // Confirm requested directories exist before marking a new head usable.
      checkedAt = new Date().toISOString();
      await this.snapshot(source, path, freshness, checkedAt);
    } catch {
      if (!previous) throw new Error("Reference refresh failed");
      // Checkout may have advanced before a later hydration step failed. Restore the verified head.
      await this.git(["checkout", "--detach", "--force", previous.revision], path, environment);
      freshness = "stale";
      checkedAt = "";
      warnings.push(`${source.label}: refresh failed; cached evidence is stale. Do not claim it is current.`);
    }
    return this.snapshot(source, path, freshness, checkedAt);
  }

  private async snapshot(source: ReferenceSource, path: string, freshness: ReferenceSnapshot["freshness"], checkedAt: string): Promise<ReferenceSnapshot> {
    const metadata = await this.git(["log", "-1", "--format=%H%n%cI%n%s"], path);
    const [revision, commitDate, ...subject] = metadata.stdout.trim().split("\n");
    if (!revision || !commitDate) throw new Error("Reference commit metadata is unavailable");
    for (const directory of source.paths) await assertDirectory(join(path, directory), "Reference evidence");
    return {
      id: source.id, label: source.label, repository: source.repository, branch: source.branch,
      path, revision, commitDate, commitSubject: subject.join("\n"), checkedAt, freshness,
      depth: source.depth, paths: source.paths, runtime: source.runtime,
    };
  }

  private async resolveAssetRipperPath(warnings: string[]): Promise<string | undefined> {
    if (!this.assetRipperPath) {
      return undefined;
    }
    try {
      await assertDirectory(this.assetRipperPath, "AssetRipper export");
      return this.assetRipperPath;
    } catch (error) {
      warnings.push(errorMessage(error));
      return undefined;
    }
  }

  private async git(args: string[], cwd: string, environment?: Record<string, string>) {
    return execFileAsync("git", ["-c", "pack.threads=1", "-c", "pack.windowMemory=16m", ...args], {
      cwd,
      env: environment ?? sanitizedEnvironment({ GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" }),
      encoding: "utf8",
      maxBuffer: MAX_OUTPUT,
      timeout: 60_000,
    });
  }

  private assertContained(path: string): void {
    const child = relative(this.root, path);
    if (!child || isAbsolute(child) || child === ".." || child.startsWith("../") || child.startsWith("..\\")) {
      throw new Error(`Refusing reference operation outside ${this.root}`);
    }
  }
}

async function assertDirectory(path: string, label: string): Promise<void> {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isDirectory()) {
    throw new Error(`${label} directory does not exist: ${path}`);
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
