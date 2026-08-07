import { execFile } from "node:child_process";
import { chmod, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { sanitizedEnvironment } from "./environment.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 10 * 1024 * 1024;

export interface PreparedRepository {
  path: string;
  branch: string;
  remoteUrl: string;
}

export class GitWorkspace {
  private readonly root: string;

  constructor(dataDir: string) {
    this.root = resolve(dataDir, "workspaces");
  }

  async prepare(input: {
    jobId: string;
    owner: string;
    repo: string;
    sourceRef: string;
    token: string;
    issueNumber: number;
  }): Promise<PreparedRepository> {
    await mkdir(this.root, { recursive: true });
    const isolatedHome = join(this.root, ".home");
    await mkdir(isolatedHome, { recursive: true });
    const path = resolve(this.root, input.jobId);
    this.assertContained(path);
    const remoteUrl = `https://github.com/${input.owner}/${input.repo}.git`;
    const branch = `diffuin/${input.issueNumber}-${input.jobId.slice(0, 8)}`;
    const auth = gitAuthEnvironment(input.token, isolatedHome);

    await this.git(["clone", "--no-checkout", "--filter=blob:none", remoteUrl, path], dirname(path), auth);
    await this.git(["fetch", "--no-tags", "origin", input.sourceRef], path, auth);
    await this.git(["checkout", "-b", branch, "FETCH_HEAD"], path);
    await this.git(["config", "user.name", "Diffuin[bot]"], path);
    await this.git(["config", "user.email", "diffuin[bot]@users.noreply.github.com"], path);
    await makeTreeReadOnly(join(path, ".git"));
    return { path, branch, remoteUrl };
  }

  async hasChanges(path: string): Promise<boolean> {
    await makeTreeWritable(join(path, ".git"));
    const result = await this.git(["status", "--porcelain"], path);
    return result.stdout.trim().length > 0;
  }

  async readPatch(path: string): Promise<string> {
    await makeTreeWritable(join(path, ".git"));
    await this.git(["add", "-N", "--", "."], path);
    return (await this.git(["diff", "--binary", "HEAD"], path)).stdout;
  }

  async commitAndPush(repository: PreparedRepository, token: string, message: string): Promise<string> {
    await makeTreeWritable(join(repository.path, ".git"));
    await this.git(["add", "--all", "--", "."], repository.path);
    await this.git(["-c", "core.hooksPath=/dev/null", "commit", "-m", message], repository.path);
    const sha = (await this.git(["rev-parse", "HEAD"], repository.path)).stdout.trim();
    await this.git(
      ["push", repository.remoteUrl, `HEAD:refs/heads/${repository.branch}`],
      repository.path,
      gitAuthEnvironment(token, join(this.root, ".home")),
    );
    return sha;
  }

  async cleanup(path: string): Promise<void> {
    const resolved = resolve(path);
    this.assertContained(resolved);
    await makeTreeWritable(join(resolved, ".git")).catch(() => undefined);
    await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  }

  private async git(args: string[], cwd: string, environment?: Record<string, string>) {
    return execFileAsync("git", args, {
      cwd,
      env: environment ?? sanitizedEnvironment({ GIT_CONFIG_NOSYSTEM: "1" }),
      encoding: "utf8",
      maxBuffer: MAX_OUTPUT,
      timeout: 5 * 60 * 1000,
    });
  }

  private assertContained(path: string): void {
    if (path === this.root || !path.startsWith(`${this.root}${sep}`)) {
      throw new Error(`Refusing workspace operation outside ${this.root}`);
    }
  }
}

function gitAuthEnvironment(token: string, home: string): Record<string, string> {
  const encoded = Buffer.from(`x-access-token:${token}`).toString("base64");
  return sanitizedEnvironment({
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${encoded}`,
    GIT_TERMINAL_PROMPT: "0",
  });
}

async function makeTreeReadOnly(path: string): Promise<void> {
  await walk(path, async (entry) => chmod(entry, 0o555));
}

async function makeTreeWritable(path: string): Promise<void> {
  await walk(path, async (entry) => chmod(entry, 0o755));
}

async function walk(path: string, action: (entry: string) => Promise<void>): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  await action(path);
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await walk(child, action);
    } else {
      await action(child);
    }
  }
}
