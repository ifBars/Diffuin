import { exportLearningEvaluation } from "../src/evaluation.js";

const [, , databaseArgument, outputArgument] = process.argv;
if (!databaseArgument || !outputArgument) {
  throw new Error("Usage: bun run learning:export -- <diffuin.sqlite> <output.jsonl>");
}

const count = exportLearningEvaluation(databaseArgument, outputArgument);
console.log(`Exported ${count} evaluation records to ${outputArgument}`);
