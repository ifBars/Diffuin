import { readFileSync } from "node:fs";
import { z } from "zod";

const sourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  label: z.string().min(1).max(120),
  repository: z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/),
  branch: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/).refine((value) => !value.includes("..")),
  paths: z.array(z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/)
    .refine((value) => !value.split("/").includes(".."))).min(1).max(8),
  depth: z.number().int().min(1).max(24).default(1),
  access: z.enum(["public", "installation"]),
  runtime: z.enum(["mono", "il2cpp", "source"]).optional(),
}).strict();

export type ReferenceSource = z.infer<typeof sourceSchema>;

export function parseReferenceCatalog(value: unknown): ReferenceSource[] {
  const sources = z.array(sourceSchema).max(8).parse(value);
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    throw new Error("Reference IDs must be unique");
  }
  return sources;
}

export function loadReferenceCatalog(path: string): ReferenceSource[] {
  return parseReferenceCatalog(JSON.parse(readFileSync(path, "utf8")));
}
