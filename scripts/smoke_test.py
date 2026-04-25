#!/usr/bin/env python3
"""Lightweight CI smoke checks for the static site."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "index.html"
REQUIRED_FILES = [
    "index.html",
    "weave_delay.js",
    "front.js",
    "settings.js",
    "oauth.js",
]
LOCAL_SCRIPT_PATTERN = re.compile(r"<script[^>]+src=[\"']([^\"']+)[\"']", re.IGNORECASE)


def fail(message: str) -> int:
    print(f"[FAIL] {message}")
    return 1


def check_required_files() -> int:
    missing = [name for name in REQUIRED_FILES if not (ROOT / name).exists()]
    if missing:
        return fail(f"Missing required files: {', '.join(missing)}")
    print("[OK] Required files exist.")
    return 0


def get_local_script_paths(index_html: str) -> list[Path]:
    scripts: list[Path] = []
    for raw_src in LOCAL_SCRIPT_PATTERN.findall(index_html):
        src = raw_src.strip()
        if src.startswith(("http://", "https://", "//")):
            continue
        clean_src = src.split("?", 1)[0]
        if not clean_src:
            continue
        scripts.append(ROOT / clean_src)
    return scripts


def check_local_script_references() -> int:
    content = INDEX_PATH.read_text(encoding="utf-8")
    missing = [path for path in get_local_script_paths(content) if not path.exists()]
    if missing:
        missing_display = ", ".join(str(path.relative_to(ROOT)) for path in missing)
        return fail(f"index.html references missing local scripts: {missing_display}")
    print("[OK] index.html local script references are valid.")
    return 0


def check_js_syntax() -> int:
    node = shutil.which("node")
    if not node:
        return fail("Node.js is required for JS syntax checks (`node --check`).")

    js_files = sorted(ROOT.glob("*.js"))
    for js_file in js_files:
        result = subprocess.run(
            [node, "--check", str(js_file)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            stdout = (result.stdout or "").strip()
            details = stderr or stdout or "Unknown syntax error."
            return fail(f"Syntax check failed for {js_file.name}: {details}")
    print(f"[OK] JavaScript syntax valid for {len(js_files)} file(s).")
    return 0


def main() -> int:
    checks = [
        check_required_files,
        check_local_script_references,
        check_js_syntax,
    ]
    for check in checks:
        code = check()
        if code != 0:
            return code
    print("[PASS] Smoke checks completed successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
