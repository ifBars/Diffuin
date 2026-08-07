import { execFile } from "node:child_process";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { sanitizedEnvironment } from "./environment.js";
import type { ScheduleOneReferences } from "./types.js";

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
  ) {
    this.root = resolve(dataDir, "references");
    this.skillPath = resolve(skillPath);
    this.assetRipperPath = assetRipperPath ? resolve(assetRipperPath) : undefined;
  }

  async prepare(): Promise<ScheduleOneReferences> {
    await assertDirectory(this.skillPath, "Schedule One skill");
    await mkdir(this.root, { recursive: true });

    const warnings: string[] = [];
    const regularSourcePath = await this.prepareBranch("alternate").catch((error: unknown) => {
      warnings.push(`Regular game source unavailable: ${errorMessage(error)}`);
      return undefined;
    });
    const betaSourcePath = await this.prepareBranch("alternate-beta").catch((error: unknown) => {
      warnings.push(`Beta game source unavailable: ${errorMessage(error)}`);
      return undefined;
    });
    const assetRipperPath = await this.resolveAssetRipperPath(warnings);

    return {
      skillPath: this.skillPath,
      regularSourcePath,
      betaSourcePath,
      assetRipperPath,
      warnings,
    };
  }

  private async prepareBranch(branch: "alternate" | "alternate-beta"): Promise<string> {
    const path = resolve(this.root, `s1-codearchiver-${branch}`);
    this.assertContained(path);

    if (!(await exists(join(path, ".git")))) {
      if (await exists(path)) {
        await rm(path, { recursive: true, force: true, maxRetries: 3 });
      }
      await this.git([
        "clone",
        "--depth",
        "1",
        "--filter=blob:none",
        "--sparse",
        "--branch",
        branch,
        "--single-branch",
        this.codeArchiverUrl,
        path,
      ], this.root);
      await this.git(["sparse-checkout", "set", "ScheduleOne-stripped"], path);
      return join(path, "ScheduleOne-stripped");
    }

    await this.git(["remote", "set-url", "origin", this.codeArchiverUrl], path);
    await this.git(["fetch", "--depth", "1", "--no-tags", "origin", branch], path);
    await this.git(["checkout", "--detach", "--force", "FETCH_HEAD"], path);
    await this.git(["sparse-checkout", "set", "ScheduleOne-stripped"], path);
    return join(path, "ScheduleOne-stripped");
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

  private async git(args: string[], cwd: string): Promise<void> {
    await execFileAsync("git", args, {
      cwd,
      env: sanitizedEnvironment({ GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" }),
      encoding: "utf8",
      maxBuffer: MAX_OUTPUT,
      timeout: 5 * 60 * 1000,
    });
  }

  private assertContained(path: string): void {
    if (path === this.root || !path.startsWith(`${this.root}${sep}`)) {
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
