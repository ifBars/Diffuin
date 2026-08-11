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
  "XDG_DATA_HOME",
  "SPARK_CMD_EXEC_DOCKER_CONTAINER",
  "SPARK_CMD_EXEC_DOCKER_WORKDIR",
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
