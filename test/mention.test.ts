import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canWrite, parseMention } from "../src/mention.js";

describe("parseMention", () => {
  it("extracts a task case-insensitively", () => {
    assert.deepEqual(parseMention("@diffuin, please fix the failing test", "Diffuin"), {
      task: "please fix the failing test",
    });
  });

  it("requires a non-empty task", () => {
    assert.equal(parseMention("hello @Diffuin", "Diffuin"), null);
  });

  it("does not match a substring", () => {
    assert.equal(parseMention("email foo@Diffuin.dev", "Diffuin"), null);
  });
});

describe("canWrite", () => {
  it("allows write-equivalent repository permissions", () => {
    assert.equal(canWrite("write"), true);
    assert.equal(canWrite("maintain"), true);
    assert.equal(canWrite("admin"), true);
    assert.equal(canWrite("triage"), false);
    assert.equal(canWrite("read"), false);
  });
});
