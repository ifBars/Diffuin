import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { ReasoningEffort } from "./types.js";

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  GITHUB_PRIVATE_KEY_BASE64: z.string().min(1).optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(16),
  DIFFUIN_HANDLE: z.string().regex(/^[A-Za-z0-9-]+$/).default("Diffuin"),
  ALLOWED_REPOSITORIES: z.string().min(1),
  DATA_DIR: z.string().default("./data"),
  CODEX_MODEL: z.string().default("gpt-5.6-luna"),
  CODEX_ALLOWED_MODELS: z.string().default("gpt-5.6-luna,gpt-5.6-terra,gpt-5.6-sol"),
  CODEX_REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high", "xhigh", "max"]).default("max"),
  CODEX_REASONING_ROUTING: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  SCHEDULE_ONE_SKILL_PATH: z.string().min(1).default("./skills/schedule-one-modding"),
  SCHEDULE_ONE_CODE_ARCHIVER_URL: z.string().url().default("https://github.com/k073l/s1-codearchiver.git"),
  SCHEDULE_ONE_ASSETRIPPER_PATH: z.string().min(1).optional(),
}).refine(
  (value) => Boolean(value.GITHUB_PRIVATE_KEY_PATH) !== Boolean(value.GITHUB_PRIVATE_KEY_BASE64),
  { message: "Set exactly one of GITHUB_PRIVATE_KEY_PATH or GITHUB_PRIVATE_KEY_BASE64" },
);

export interface Config {
  port: number;
  githubAppId: number;
  githubPrivateKey: string;
  githubWebhookSecret: string;
  handle: string;
  allowedRepositories: ReadonlySet<string>;
  dataDir: string;
  codexModel: string;
  allowedCodexModels: ReadonlySet<string>;
  codexReasoningEffort: ReasoningEffort;
  autoReasoningRouting: boolean;
  jobPollIntervalMs: number;
  scheduleOneSkillPath: string;
  scheduleOneCodeArchiverUrl: string;
  scheduleOneAssetRipperPath?: string | undefined;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(environment);
  const allowedRepositories = new Set(
    parsed.ALLOWED_REPOSITORIES.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
  );
  const allowedCodexModels = new Set(
    parsed.CODEX_ALLOWED_MODELS.split(",").map((value) => value.trim()).filter(Boolean),
  );
  allowedCodexModels.add(parsed.CODEX_MODEL);

  return {
    port: parsed.PORT,
    githubAppId: parsed.GITHUB_APP_ID,
    githubPrivateKey: parsed.GITHUB_PRIVATE_KEY_PATH
      ? readFileSync(resolve(parsed.GITHUB_PRIVATE_KEY_PATH), "utf8")
      : Buffer.from(parsed.GITHUB_PRIVATE_KEY_BASE64!, "base64").toString("utf8"),
    githubWebhookSecret: parsed.GITHUB_WEBHOOK_SECRET,
    handle: parsed.DIFFUIN_HANDLE,
    allowedRepositories,
    dataDir: resolve(parsed.DATA_DIR),
    codexModel: parsed.CODEX_MODEL,
    allowedCodexModels,
    codexReasoningEffort: parsed.CODEX_REASONING_EFFORT,
    autoReasoningRouting: parsed.CODEX_REASONING_ROUTING,
    jobPollIntervalMs: parsed.JOB_POLL_INTERVAL_MS,
    scheduleOneSkillPath: resolve(parsed.SCHEDULE_ONE_SKILL_PATH),
    scheduleOneCodeArchiverUrl: parsed.SCHEDULE_ONE_CODE_ARCHIVER_URL,
    scheduleOneAssetRipperPath: parsed.SCHEDULE_ONE_ASSETRIPPER_PATH
      ? resolve(parsed.SCHEDULE_ONE_ASSETRIPPER_PATH)
      : undefined,
  };
}
