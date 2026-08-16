from __future__ import annotations

"""Load opendashboard-harness/.env into process env (does not override existing exports)."""

import os
from pathlib import Path
from typing import Optional


def load_dotenv(path: Optional[Path] = None) -> Optional[Path]:
    env_path = path or (Path(__file__).resolve().parent / ".env")
    if not env_path.is_file():
        return None
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'").strip('"')
        if not key:
            continue
        # Prefer .env when shell var is missing or blank (so local .env wins for empty exports)
        cur = os.environ.get(key)
        if cur is None or cur == "":
            os.environ[key] = val
    return env_path
