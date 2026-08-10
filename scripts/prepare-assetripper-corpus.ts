import { copyFile, mkdir, open, opendir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";

const STRUCTURAL_ROOTS = new Set([
  "AnimationClip",
  "AnimatorController",
  "AudioMixerController",
  "Avatar",
  "GameObject",
  "Material",
  "MonoBehaviour",
  "PhysicMaterial",
  "RenderTexture",
  "Resources",
  "Scenes",
  "StreamingAssets",
  "TerrainLayer",
  "TextAsset",
]);

const STRUCTURAL_EXTENSIONS = new Set([
  ".anim",
  ".asset",
  ".bytes",
  ".controller",
  ".json",
  ".lighting",
  ".mat",
  ".mixer",
  ".physicmaterial",
  ".prefab",
  ".rendertexture",
  ".terrainlayer",
  ".txt",
  ".unity",
]);

const LARGE_OR_PRESENTATION_ONLY_ASSET_TYPES = new Set([
  "AudioClip",
  "Cubemap",
  "Font",
  "Mesh",
  "NavMeshData",
  "Sprite",
  "TerrainData",
  "Texture2D",
  "Texture3D",
  "VideoClip",
]);

interface CorpusManifest {
  formatVersion: 1;
  generatedAt: string;
  files: number;
  bytes: number;
  retainedRoots: string[];
  retainedExtensions: string[];
  excludedAssetTypes: string[];
  metaPolicy: string;
}

const [sourceArgument, destinationArgument] = process.argv.slice(2);
if (!sourceArgument || !destinationArgument) {
  throw new Error("Usage: bun run assetripper:prepare -- <ExportedProject/Assets> <destination>");
}

const sourceRoot = resolve(sourceArgument);
const destinationRoot = resolve(destinationArgument);
if (!(await stat(sourceRoot).catch(() => undefined))?.isDirectory()) {
  throw new Error(`AssetRipper Assets directory does not exist: ${sourceRoot}`);
}
const existingDestination = await stat(destinationRoot).catch(() => undefined);
if (existingDestination) {
  if (!existingDestination.isDirectory() || (await readdir(destinationRoot)).length > 0) {
    throw new Error(`Destination must not exist or must be empty: ${destinationRoot}`);
  }
}

await mkdir(destinationRoot, { recursive: true });
let files = 0;
let bytes = 0;

for await (const sourceFile of walkFiles(sourceRoot)) {
  const corpusPath = relative(sourceRoot, sourceFile);
  if (!(await shouldRetain(sourceFile, corpusPath))) continue;
  const destinationFile = resolve(destinationRoot, corpusPath);
  await mkdir(dirname(destinationFile), { recursive: true });
  await copyFile(sourceFile, destinationFile);
  const info = await stat(sourceFile);
  files += 1;
  bytes += info.size;
}

const manifest: CorpusManifest = {
  formatVersion: 1,
  generatedAt: new Date().toISOString(),
  files,
  bytes,
  retainedRoots: [...STRUCTURAL_ROOTS].sort(),
  retainedExtensions: [...STRUCTURAL_EXTENSIONS].sort(),
  excludedAssetTypes: [...LARGE_OR_PRESENTATION_ONLY_ASSET_TYPES].sort(),
  metaPolicy: "Retain every .meta file so GUID references still resolve to original asset names.",
};
await writeFile(resolve(destinationRoot, "diffuin-assetripper-corpus.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Prepared ${files.toLocaleString()} files (${formatBytes(bytes)}) at ${destinationRoot}`);

async function shouldRetain(file: string, corpusPath: string): Promise<boolean> {
  const segments = corpusPath.split(sep);
  const extension = extname(file).toLowerCase();
  if (extension === ".meta") return true;
  if (!STRUCTURAL_ROOTS.has(segments[0] ?? "")) return false;
  if (!STRUCTURAL_EXTENSIONS.has(extension)) return false;
  if (extension !== ".asset") return true;
  const assetType = await readUnityYamlType(file);
  return !assetType || !LARGE_OR_PRESENTATION_ONLY_ASSET_TYPES.has(assetType);
}

async function readUnityYamlType(file: string): Promise<string | undefined> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(8_192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").match(/(?:^|\r?\n)([A-Za-z][A-Za-z0-9_]*):\r?\n/)?.[1];
  } finally {
    await handle.close();
  }
}

async function* walkFiles(directory: string): AsyncGenerator<string> {
  const entries = await opendir(directory);
  for await (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* walkFiles(path);
    else if (entry.isFile()) yield path;
  }
}

function formatBytes(value: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}
