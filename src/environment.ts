const SAFE_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
] as const;

export function sanitizedEnvironment(overrides: Record<string, string> = {}): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of SAFE_KEYS) {
    const value = process.env[key];
    if (value) {
      environment[key] = value;
    }
  }
  return { ...environment, ...overrides };
}
