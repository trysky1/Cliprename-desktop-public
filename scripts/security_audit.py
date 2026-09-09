#!/usr/bin/env python3
"""Fail CI when tracked files or Git history contain common credential forms."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SECRET_PATTERNS = {
    "AWS access key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "GitHub token": re.compile(rb"\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"),
    "Google API key": re.compile(rb"\bAIza[0-9A-Za-z_-]{30,}\b"),
    "OpenAI-style key": re.compile(rb"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b"),
    "private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "Slack token": re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    "Stripe live key": re.compile(rb"\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b"),
}
UNSAFE_WORKFLOW = {
    "mutable action reference": re.compile(rb"uses:\s*[^\s#]+@(?![0-9a-f]{40}(?:\s|$))[^\s#]+"),
}


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT, stderr=subprocess.DEVNULL)


def scan(label: str, data: bytes, patterns: dict[str, re.Pattern[bytes]]) -> list[str]:
    findings = []
    for name, pattern in patterns.items():
        if pattern.search(data):
            findings.append(f"{label}: {name}")
    return findings


def scan_workflow_shell(label: str, data: bytes) -> list[str]:
    """Detect direct secret expressions only inside a YAML run block."""
    findings = []
    run_indent: int | None = None
    for line_number, line in enumerate(data.splitlines(), 1):
        stripped = line.lstrip()
        indent = len(line) - len(stripped)
        if run_indent is not None and stripped and indent <= run_indent:
            run_indent = None
        if re.match(rb"run:\s*[|>-]", stripped):
            run_indent = indent
            continue
        if run_indent is not None and b"${{ secrets." in line:
            findings.append(f"{label}:{line_number}: secret interpolated into shell")
    return findings


def main() -> int:
    findings: list[str] = []
    tracked = git("ls-files", "-z").split(b"\0")
    for raw_path in filter(None, tracked):
        path = ROOT / raw_path.decode("utf-8", "surrogateescape")
        if path == Path(__file__):
            continue  # This file necessarily contains the signatures it detects.
        data = path.read_bytes()
        findings.extend(scan(str(path.relative_to(ROOT)), data, SECRET_PATTERNS))
        if path.parts[-3:-1] == (".github", "workflows"):
            findings.extend(scan(str(path.relative_to(ROOT)), data, UNSAFE_WORKFLOW))
            findings.extend(scan_workflow_shell(str(path.relative_to(ROOT)), data))

    # Scan every reachable historical blob. A secret removed in the latest
    # commit remains public and usable until it is rotated and history rewritten.
    objects = subprocess.Popen(
        ["git", "rev-list", "--objects", "--all"], cwd=ROOT, stdout=subprocess.PIPE
    )
    assert objects.stdout is not None
    batch = subprocess.Popen(
        ["git", "cat-file", "--batch"], cwd=ROOT,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    assert batch.stdin is not None and batch.stdout is not None
    for line in objects.stdout:
        oid, _, name = line.rstrip(b"\n").partition(b" ")
        batch.stdin.write(oid + b"\n")
        batch.stdin.flush()
        header = batch.stdout.readline().split()
        if len(header) < 3:
            continue
        size = int(header[2])
        data = batch.stdout.read(size)
        batch.stdout.read(1)
        if header[1] != b"blob":
            continue
        if name == b"scripts/security_audit.py":
            continue
        findings.extend(scan(f"history:{name.decode(errors='replace')}@{oid[:12].decode()}", data, SECRET_PATTERNS))
    batch.stdin.close()
    batch.wait()
    objects.wait()

    if findings:
        print("Security audit failed:", file=sys.stderr)
        for finding in sorted(set(findings)):
            print(f"  - {finding}", file=sys.stderr)
        print("Rotate exposed credentials before rewriting history.", file=sys.stderr)
        return 1
    print(f"Security audit passed: {len(tracked)} tracked files and all reachable Git blobs checked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
