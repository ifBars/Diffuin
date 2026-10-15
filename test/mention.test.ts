import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canWrite, parseMention } from "../src/mention.js";

describe("parseMention", () => {
  it("preserves natural-language requests without classifying their intent", () => {
    for (const task of [
      "Do a new investigative plan on the latest and open a new PR",
      "review this pull request and fix the regression",
      "Investigate this issue deeply and create a plan to fix it",
      "Could you create a plan for this issue?",
      "How do I fix the null dereference?",
      "Why does this fail? Please fix the regression.",
      "onboard this repository",
      "write a release announcement and suggest a title",
      "take a look at this",
    ]) {
      assert.deepEqual(parseMention(`@Diffuin ${task}`, "Diffuin"), { task, mode: "auto" });
    }
    assert.deepEqual(parseMention("@diffuin, please fix the failing test", "Diffuin"), {
      task: "please fix the failing test", mode: "auto",
    });
  });

  it("supports model and effort options without selecting a task mode", () => {
    const command = parseMention("@Diffuin --model gpt-6.1-sol --effort high -- Do a new plan and open a PR", "Diffuin");
    assert.equal(command?.mode, "auto");
    assert.equal(command?.task, "Do a new plan and open a PR");
    assert.equal(command?.requestedModel, "gpt-6.1-sol");
    assert.equal(command?.requestedReasoningEffort, "high");
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
