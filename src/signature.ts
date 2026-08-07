import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGitHubSignature(payload: Buffer, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) {
    return false;
  }

  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`);
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
