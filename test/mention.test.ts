import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canWrite, parseMention } from "../src/mention.js";

describe("parseMention", () => {
  it("extracts a task case-insensitively", () => {
    assert.deepEqual(parseMention("@diffuin, please fix the failing test", "Diffuin"), {
      task: "please fix the failing test",
      mode: "implement",
    });
  });

  it("uses the final deliverable in compound natural-language requests", () => {
    assert.deepEqual(
      parseMention("@Diffuin Investigate this issue deeply and create a plan to fix it", "Diffuin"),
      {
        task: "Investigate this issue deeply and create a plan to fix it",
        mode: "plan",
      },
    );
    assert.equal(parseMention("@Diffuin review this pull request and fix the regression", "Diffuin")?.mode, "implement");
  });

  it("keeps explicit option-bearing commands strict", () => {
    assert.equal(
      parseMention("@Diffuin investigate -- research whether a plan is needed", "Diffuin")?.mode,
      "investigate",
    );
  });

  it("distinguishes polite requests from questions about an action", () => {
    assert.equal(parseMention("@Diffuin Could you create a plan for this issue?", "Diffuin")?.mode, "plan");
    assert.equal(parseMention("@Diffuin Can you fix the null dereference?", "Diffuin")?.mode, "implement");
    assert.equal(parseMention("@Diffuin How do I fix the null dereference?", "Diffuin")?.mode, "answer");
    assert.equal(parseMention("@Diffuin Should we create a plan before changing this?", "Diffuin")?.mode, "answer");
    assert.equal(parseMention("@Diffuin Should we investigate this and fix it?", "Diffuin")?.mode, "answer");
    assert.equal(parseMention("@Diffuin Why does this fail? Please fix the regression.", "Diffuin")?.mode, "implement");
  });

  it("leaves ambiguous natural-language requests for semantic interpretation", () => {
    assert.equal(parseMention("@Diffuin take a look at this", "Diffuin")?.mode, "auto");
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

  it("supports an explicit investigation workflow", () => {
    assert.deepEqual(parseMention("@Diffuin investigate -- research the persistence seam", "Diffuin"), {
      task: "research the persistence seam",
      mode: "investigate",
      requestedModel: undefined,
      requestedReasoningEffort: undefined,
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
