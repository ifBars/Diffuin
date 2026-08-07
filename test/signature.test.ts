import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { verifyGitHubSignature } from "../src/signature.js";

describe("verifyGitHubSignature", () => {
  it("accepts a valid sha256 signature", () => {
    const body = Buffer.from('{"zen":"hello"}');
    const secret = "a sufficiently long webhook secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    assert.equal(verifyGitHubSignature(body, signature, secret), true);
  });

  it("rejects missing and malformed signatures", () => {
    const body = Buffer.from("payload");
    assert.equal(verifyGitHubSignature(body, null, "secret"), false);
    assert.equal(verifyGitHubSignature(body, "sha256=bad", "secret"), false);
  });
});
