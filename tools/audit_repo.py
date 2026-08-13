"""Check whether this repository is safe to publish.

Run before making the repo public. Looks for the things that actually leak:
credentials, tokens, personal identifiers, and absolute paths that expose the
author's machine.
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (label, pattern, severity) - severity 'block' fails the audit
CHECKS = [
    ("private key block", r"-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY", "block"),
    ("GitHub token", r"gh[pousr]_[A-Za-z0-9]{16,}", "block"),
    ("AWS access key", r"AKIA[0-9A-Z]{16}", "block"),
    ("Slack token", r"xox[baprs]-[0-9A-Za-z-]{10,}", "block"),
    ("Google API key", r"AIza[0-9A-Za-z_\-]{35}", "block"),
    ("generic secret assignment", r"(?i)(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*[\"'][A-Za-z0-9/+_\-]{16,}[\"']", "block"),
    ("Apple ASC key id", r"AuthKey_[A-Z0-9]{10}", "warn"),
    ("Windows absolute path", r"[A-Za-z]:[\\/](Users|cowork)[\\/]", "warn"),
    ("email address", r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", "warn"),
]

ALLOWED_EMAILS = {"noreply@anthropic.com", "i@izs.me"}
SKIP_EXT = {".bin", ".png", ".jpg", ".jpeg", ".ico", ".woff", ".woff2", ".zip"}


def tracked_files():
    out = subprocess.run(["git", "ls-files"], capture_output=True, text=True, cwd=ROOT)
    return [f for f in out.stdout.splitlines() if f]


def main():
    files = tracked_files()
    if not files:
        print("no tracked files - run `git add -A` first")
        return 1

    total = 0
    findings = {"block": [], "warn": []}
    for rel in files:
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path):
            continue
        total += os.path.getsize(path)
        if os.path.splitext(rel)[1].lower() in SKIP_EXT:
            continue
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
        except Exception:
            continue
        for label, pattern, sev in CHECKS:
            for m in re.finditer(pattern, text):
                hit = m.group(0)
                if label == "email address" and hit.lower() in ALLOWED_EMAILS:
                    continue
                line = text[: m.start()].count("\n") + 1
                findings[sev].append((rel, line, label, hit[:70]))

    print(f"{len(files)} tracked files, {total/1e6:.1f} MB\n")

    if findings["block"]:
        print(f"BLOCKING ({len(findings['block'])}) - do not publish until resolved:")
        for rel, line, label, hit in findings["block"][:20]:
            print(f"  {rel}:{line}  {label}: {hit}")
        print()
    else:
        print("BLOCKING: none\n")

    if findings["warn"]:
        seen = {}
        for rel, line, label, hit in findings["warn"]:
            seen.setdefault(label, []).append(f"{rel}:{line} {hit}")
        print(f"WORTH A LOOK ({len(findings['warn'])}):")
        for label, items in seen.items():
            print(f"  {label} ({len(items)}):")
            for i in items[:6]:
                print(f"     {i}")
            if len(items) > 6:
                print(f"     ... and {len(items)-6} more")
    else:
        print("WORTH A LOOK: none")

    return 1 if findings["block"] else 0


if __name__ == "__main__":
    sys.exit(main())
