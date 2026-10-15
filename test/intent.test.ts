import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { artifactSchema } from "../src/artifact.js";
import { assertPublicationAllowed, requestsPublication } from "../src/intent.js";

describe("publication policy", () => {
  it("accepts a generic response without intent or kind labels", () => {
    const artifact = artifactSchema.parse({ body: "Here is the plan and the result.", publishChanges: true });
    assert.doesNotThrow(() => assertPublicationAllowed("auto", artifact));
    assert.equal(requestsPublication(artifact), true);
  });

  it("allows arbitrary response labels without making them publication authority", () => {
    const artifact = artifactSchema.parse({ body: "A mixed response.", intent: "anything", kind: "custom", workflow: "none", publishChanges: true });
    assert.doesNotThrow(() => assertPublicationAllowed("implement", artifact));
  });

  it("rejects publication under explicit read-only commands", () => {
    const artifact = artifactSchema.parse({ body: "Changed files.", publishChanges: true });
    for (const mode of ["review", "investigate", "plan", "answer"] as const) {
      assert.throws(() => assertPublicationAllowed(mode, artifact), /read-only/);
    }
  });

  it("honors an explicit no-publish decision even on legacy implementation artifacts", () => {
    const artifact = artifactSchema.parse({ summary: "Not ready.", intent: "implement", publishChanges: false });
    assert.equal(requestsPublication(artifact), false);
    assert.throws(() => assertPublicationAllowed("auto", artifact), /without requesting publication/);
  });
});
