import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canWrite, parseMention } from "../src/mention.js";

describe("parseMention", () => {
  it("extracts a task case-insensitively", () => {
    assert.deepEqual(parseMention("@diffuin, please fix the failing test", "Diffuin"), {
      task: "please fix the failing test",
      mode: "auto",
    });
  });

  it("parses explicit model and effort overrides", () => {
    assert.deepEqual(
      parseMention(
        "@Diffuin review --model gpt-5.6-terra --effort high -- focus on multiplayer authority",
        "Diffuin",
      ),
      {
        task: "focus on multiplayer authority",
        mode: "review",
        requestedModel: "gpt-5.6-terra",
        requestedReasoningEffort: "high",
      },
    );
  });

  it("provides a default task for command-only mentions", () => {
    assert.deepEqual(parseMention("@Diffuin plan --effort=xhigh", "Diffuin"), {
      task: "produce an implementation plan for this issue",
      mode: "plan",
      requestedModel: undefined,
      requestedReasoningEffort: "xhigh",
    });
  });

  it("returns a user-facing error for invalid options", () => {
    assert.match(parseMention("@Diffuin review --effort turbo", "Diffuin")?.error ?? "", /--effort/);
    assert.match(parseMention("@Diffuin review --model --effort high", "Diffuin")?.error ?? "", /--model/);
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
