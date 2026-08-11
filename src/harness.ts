import type { CodexPort, CodexResult } from "./types.js";

export class ModelRoutedHarness implements CodexPort {
  constructor(
    private readonly codex: CodexPort,
    private readonly spark: CodexPort,
    private readonly sparkModels: ReadonlySet<string>,
  ) {}

  run(
    workingDirectory: Parameters<CodexPort["run"]>[0],
    prompt: Parameters<CodexPort["run"]>[1],
    options: Parameters<CodexPort["run"]>[2],
  ): Promise<CodexResult> {
    const provider = this.sparkModels.has(options.model) ? this.spark : this.codex;
    return provider.run(workingDirectory, prompt, options);
  }
}
