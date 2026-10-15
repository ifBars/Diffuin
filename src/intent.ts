import type { DiffuinArtifact } from "./artifact.js";
import type { TaskMode } from "./types.js";

export function requestsPublication(artifact: DiffuinArtifact): boolean {
  // Existing stored artifacts predate the explicit delivery flag.
  return artifact.publishChanges ?? (!artifact.body && artifact.intent === "implement");
}

export function assertPublicationAllowed(mode: TaskMode, artifact: DiffuinArtifact): void {
  if (mode !== "auto" && mode !== "implement") {
    throw new Error(`The agent modified files during a read-only ${mode} request; refusing to publish the patch`);
  }
  if (!requestsPublication(artifact)) {
    throw new Error("The agent modified files without requesting publication; refusing to publish the patch");
  }
}
