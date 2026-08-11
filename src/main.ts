import { join } from "node:path";
import { CodexClient } from "./codex.js";
import { ModelRoutedHarness } from "./harness.js";
import { AssetRipperReadBroker } from "./assetripper-read-broker.js";
import { loadConfig } from "./config.js";
import { GitWorkspace } from "./git.js";
import { GitHubClient } from "./github.js";
import { GitHubReadBroker } from "./github-read-broker.js";
import { createDiffuinServer } from "./server.js";
import { JobStore } from "./store.js";
import { Worker } from "./worker.js";
import { ScheduleOneReferenceWorkspace } from "./references.js";
import { SparkClient } from "./spark.js";

const config = loadConfig();
const store = new JobStore(join(config.dataDir, "diffuin.sqlite"));
const github = new GitHubClient(config.githubAppId, config.githubPrivateKey, config.githubWebhookSecret);
const githubReadBroker = new GitHubReadBroker(github);
await githubReadBroker.start();
const assetRipperReadBroker = new AssetRipperReadBroker();
await assetRipperReadBroker.start();
const codex = new ModelRoutedHarness(
  new CodexClient(config.dataDir),
  new SparkClient(
    config.sparkCommand,
    config.dataDir,
    config.sparkTimeoutMs,
    config.sparkAllowUnsandboxedCommands,
  ),
  config.sparkModels,
);
const references = new ScheduleOneReferenceWorkspace(
  config.dataDir,
  config.scheduleOneSkillPath,
  config.scheduleOneCodeArchiverUrl,
  config.scheduleOneAssetRipperPath,
);
const worker = new Worker(
  config,
  store,
  github,
  codex,
  new GitWorkspace(config.dataDir),
  references,
  githubReadBroker,
  assetRipperReadBroker,
);
const server = createDiffuinServer(config, store, github);

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Diffuin listening on port ${config.port}`);
});

void worker.start().catch((error: unknown) => {
  console.error("Diffuin worker stopped unexpectedly", error);
  process.exitCode = 1;
  server.close();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    worker.stop();
    server.close(() => {
      void Promise.all([githubReadBroker.stop(), assetRipperReadBroker.stop()]).finally(() => {
        store.close();
        process.exit(0);
      });
    });
  });
}
