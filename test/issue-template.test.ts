import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkIssueTemplate, issueTemplatePath, templateReminder } from "../src/issue-template.js";

const form = `name: Bug report
body:
  - type: markdown
    attributes:
      value: Instructions only
  - type: textarea
    attributes:
      label: Summary
    validations:
      required: true
  - type: textarea
    attributes:
      label: Logs
  - type: checkboxes
    attributes:
      label: Checklist
      options:
        - label: I searched existing issues
          required: true
        - label: I attached optional logs
          required: false
`;

describe("issue form compliance", () => {
  it("checks required sections and mandatory checkboxes without requiring optional information", () => {
    assert.equal(checkIssueTemplate(form, "### Summary\nA real bug.\n\n### Checklist\n- [x] I searched existing issues\n- [ ] I attached optional logs").status, "complete");
    assert.deepEqual(checkIssueTemplate(form, "### Summary\n_No response_\n\n### Checklist\n- [ ] I searched existing issues"),
      { status: "incomplete", missing: ["Summary", "Checklist"] });
    assert.equal(checkIssueTemplate(form, "A free-form report without template sections").status, "incomplete");
    assert.equal(checkIssueTemplate(form, "### Summary\n<!-- placeholder -->\n\n### Checklist\n- [x] I searched existing issues").status, "incomplete");
  });

  it("does not mistake headings inside code for completed form sections", () => {
    assert.deepEqual(checkIssueTemplate(form, "```md\n### Summary\nFake heading\n```\n### Checklist\n- [x] I searched existing issues"),
      { status: "incomplete", missing: ["Summary"] });
    assert.equal(checkIssueTemplate(form, "### Summary\n```cs\nthrow new Exception();\n```\n### Checklist\n- [X] I searched existing issues").status, "complete");
  });

  it("treats unreadable, unsupported, aliased, or ambiguous forms as unknown", () => {
    for (const source of ["bad: [", "body: []", "body: [{type: markdown}]", "body: &a [*a]", "body: [{type: unknown, validations: {required: true}}]"]) {
      assert.equal(checkIssueTemplate(source, null).status, "unknown");
    }
    assert.equal(checkIssueTemplate(form, "### Summary\none\n### Summary\ntwo").status, "unknown");
    assert.throws(() => issueTemplatePath.parse("../../secret"));
  });

  it("uses a fixed short reminder with the matching template link and deduplication marker", () => {
    const bug = templateReminder("bug", "example/project", ".github/ISSUE_TEMPLATE/bug_report.yml");
    assert.match(bug, /template-reminder:bug/);
    assert.match(bug, /bug report template/);
    assert.match(bug, /issues\/new\?template=bug_report.yml/);
    const feature = templateReminder("feature", "example/project", ".github/ISSUE_TEMPLATE/feature_request.yml");
    assert.match(feature, /understand and evaluate your request/);
    assert.match(feature, /template-reminder:feature/);
  });
});
