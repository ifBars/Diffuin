const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\b(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["OpenAI key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];

export function assertNoSecrets(value: string): void {
  for (const [label, pattern] of SECRET_PATTERNS) {
    if (pattern.test(value)) {
      throw new Error(`Refusing to publish content that resembles a ${label}`);
    }
  }
}
