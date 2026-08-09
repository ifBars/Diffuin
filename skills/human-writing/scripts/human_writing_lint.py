#!/usr/bin/env python3
"""Advisory checks for recurring weak-prose patterns.

This is not an ASD-STE100 compliance checker. It reports mechanical signals
that a writer must review in context.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path


MARKETING = {
    "battle-tested",
    "cutting-edge",
    "effortless",
    "game-changing",
    "groundbreaking",
    "next-generation",
    "powerful",
    "revolutionary",
    "robust",
    "seamless",
    "state-of-the-art",
    "world-class",
}

HEDGES = {
    "it is important to note",
    "it should be noted",
    "it is worth noting",
    "may potentially",
    "might potentially",
    "please note that",
}

PHRASAL_VERBS = {
    "circle back",
    "dive into",
    "drill down",
    "kick off",
    "reach out",
    "roll out",
    "spin down",
    "spin up",
}

CHATBOT_ARTIFACTS = {
    "certainly!",
    "great question",
    "i hope this helps",
    "let me know if",
    "of course!",
    "would you like me to",
}

NOMINALIZATION_PATTERNS = (
    r"\b(?:conduct|perform|provide|make|carry out)(?:s|ed|ing)?\s+"
    r"(?:an?\s+)?(?:analysis|assessment|determination|evaluation|review|"
    r"adjustment|improvement|assistance|recommendation)\b"
)

PASSIVE_PATTERN = (
    r"\b(?:am|is|are|was|were|be|been|being)\s+"
    r"(?:\w+ed|built|done|found|given|held|kept|known|made|read|run|"
    r"seen|sent|set|shown|taken|written)\b"
)


@dataclass(frozen=True)
class Finding:
    category: str
    line: int
    excerpt: str


def strip_code(text: str) -> str:
    text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
    return re.sub(r"`[^`\n]+`", "", text)


def sentence_parts(line: str) -> list[str]:
    clean = re.sub(r"^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)", "", line)
    return [
        part.strip()
        for part in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])", clean)
        if part.strip()
    ]


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'/-]*", text))


def phrase_findings(
    lines: list[str], category: str, phrases: set[str]
) -> list[Finding]:
    findings: list[Finding] = []
    for number, line in enumerate(lines, 1):
        lowered = line.lower()
        for phrase in sorted(phrases):
            if re.search(rf"(?<![a-z]){re.escape(phrase)}(?![a-z])", lowered):
                findings.append(Finding(category, number, line.strip()))
    return findings


def lint(text: str, mode: str) -> tuple[list[Finding], int]:
    clean = strip_code(text)
    lines = clean.splitlines()
    findings: list[Finding] = []

    findings.extend(phrase_findings(lines, "marketing", MARKETING))
    findings.extend(phrase_findings(lines, "hedge", HEDGES))
    findings.extend(phrase_findings(lines, "chatbot-artifact", CHATBOT_ARTIFACTS))

    if mode in {"strict", "clarity"}:
        findings.extend(phrase_findings(lines, "phrasal-verb", PHRASAL_VERBS))

    sentence_limit = 20 if mode == "strict" else 30 if mode == "clarity" else 40
    for number, line in enumerate(lines, 1):
        for sentence in sentence_parts(line):
            count = word_count(sentence)
            if count > sentence_limit:
                findings.append(
                    Finding(
                        "long-sentence",
                        number,
                        f"{count} words: {sentence}",
                    )
                )

        if re.search(NOMINALIZATION_PATTERNS, line, flags=re.IGNORECASE):
            findings.append(Finding("nominalization", number, line.strip()))
        if re.search(PASSIVE_PATTERN, line, flags=re.IGNORECASE):
            findings.append(Finding("possible-passive", number, line.strip()))

        if mode == "strict":
            if ";" in line:
                findings.append(Finding("semicolon", number, line.strip()))
            if re.search(r"\b\w+['’](?:d|ll|m|re|s|t|ve)\b", line):
                findings.append(Finding("contraction", number, line.strip()))

    words = max(word_count(clean), 1)
    score = round(len(findings) * 100 / words, 2)
    return findings, score


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Report mechanical weak-prose signals. Advisory only."
    )
    parser.add_argument("path", type=Path)
    parser.add_argument(
        "--mode",
        choices=("strict", "clarity", "voice"),
        default="clarity",
    )
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--fail-on-findings", action="store_true")
    args = parser.parse_args()

    text = args.path.read_text(encoding="utf-8")
    findings, score = lint(text, args.mode)
    result = {
        "mode": args.mode,
        "words": word_count(strip_code(text)),
        "findings": [asdict(finding) for finding in findings],
        "finding_count": len(findings),
        "findings_per_100_words": score,
        "disclaimer": "Advisory only; not ASD-STE100 certification.",
    }

    if args.as_json:
        print(json.dumps(result, indent=2))
    else:
        print(
            f"{len(findings)} finding(s), {score} per 100 words "
            f"[{args.mode} mode]"
        )
        for finding in findings:
            print(f"{finding.line}: {finding.category}: {finding.excerpt}")
        print(result["disclaimer"])

    return 1 if args.fail_on_findings and findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
