import { parseDocument } from "yaml";
import { z } from "zod";

export const issueTemplatePath = z.string().regex(/^\.github\/ISSUE_TEMPLATE\/[A-Za-z0-9_-]+\.ya?ml$/);

const formSchema = z.object({
  body: z.array(z.object({
    type: z.string(),
    attributes: z.object({
      label: z.string().min(1).max(300).optional(),
      options: z.array(z.union([z.string(), z.object({ label: z.string(), required: z.boolean().optional() })])).optional(),
    }).optional(),
    validations: z.object({ required: z.boolean().optional() }).optional(),
  })).min(1).max(100),
});

export function checkIssueTemplate(source: string, body: string | null) {
  try {
    if (Buffer.byteLength(source, "utf8") > 100_000) throw new Error();
    const document = parseDocument(source);
    if (document.errors.length || document.warnings.length) throw new Error();
    const form = formSchema.parse(document.toJS({ maxAliasCount: 0 }));
    const sections = new Map<string, string>();
    const withoutCode = (body ?? "").replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[^\n]*$/gm,
      (block) => block.replace(/^###/gm, "    ###"));
    const headings = [...withoutCode.matchAll(/^###\s+(.+?)\s*#*\s*$/gm)];
    for (let index = 0; index < headings.length; index++) {
      const heading = headings[index]!;
      const key = normalize(heading[1]!);
      // Duplicate form sections are ambiguous; do not silently accept the last one.
      if (sections.has(key)) throw new Error();
      sections.set(key, withoutCode.slice(heading.index! + heading[0].length, headings[index + 1]?.index).trim());
    }
    const missing: string[] = [];
    let required = 0;
    for (const field of form.body) {
      if (field.type === "markdown") continue;
      const label = field.attributes?.label;
      const requiredOptions = field.type === "checkboxes"
        ? (field.attributes?.options ?? []).filter((option) => typeof option !== "string" && option.required) : [];
      if (!field.validations?.required && !requiredOptions.length) continue;
      if (!label || !["input", "textarea", "dropdown", "checkboxes"].includes(field.type)) throw new Error();
      required++;
      const answer = sections.get(normalize(label)) ?? "";
      const meaningful = answer.replace(/<!--[\s\S]*?-->/g, "").trim();
      if (!meaningful || /^[_*\s]*(?:no response|none|n\/a)[_*\s]*$/i.test(meaningful)) {
        missing.push(label);
        continue;
      }
      if (field.type === "checkboxes") {
        const checked = new Set([...answer.matchAll(/^\s*[-*]\s+\[[xX]\]\s+(.+)$/gm)].map((match) => normalize(match[1]!)));
        if (requiredOptions.some((option) => typeof option !== "string" && !checked.has(normalize(option.label))) ||
            (field.validations?.required && !checked.size)) missing.push(label);
      }
    }
    if (!required) return { status: "unknown" as const, missing: [] };
    return { status: missing.length ? "incomplete" as const : "complete" as const, missing };
  } catch {
    return { status: "unknown" as const, missing: [] };
  }
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function templateReminder(kind: "bug" | "feature", repository: string, path: string) {
  issueTemplatePath.parse(path);
  const name = kind === "bug" ? "bug report" : "feature request";
  const purpose = kind === "bug" ? "reproduce and fix your issue" : "understand and evaluate your request";
  return `<!-- diffuin:template-reminder:${kind} -->\n` +
    `It looks like the ${name} template wasn't followed completely. These templates help us ${purpose} quicker. ` +
    `Please update your issue using the [${name} template](https://github.com/${repository}/issues/new?template=${encodeURIComponent(path.split("/").at(-1)!)}), including the required information. Thanks!`;
}
