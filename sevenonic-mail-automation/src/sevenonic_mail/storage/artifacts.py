from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path


class ArtifactStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def sha256(content: bytes) -> str:
        return hashlib.sha256(content).hexdigest()

    @staticmethod
    def safe_filename(filename: str) -> str:
        base = os.path.basename(filename).strip() or "unnamed.bin"
        return re.sub(r"[^A-Za-z0-9._\-\u4e00-\u9fff]+", "_", base)[:180]

    def put(self, namespace: str, filename: str, content: bytes) -> tuple[str, str]:
        digest = self.sha256(content)
        safe_namespace = re.sub(r"[^A-Za-z0-9._-]+", "_", namespace)
        directory = (self.root / safe_namespace / digest[:2] / digest).resolve()
        if self.root not in directory.parents:
            raise ValueError("artifact path escaped configured root")
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / self.safe_filename(filename)
        if path.exists():
            existing = path.read_bytes()
            if self.sha256(existing) != digest:
                raise ValueError("existing artifact hash mismatch")
        else:
            path.write_bytes(content)
        return str(path), digest

    def read(self, uri: str) -> bytes:
        path = Path(uri).resolve()
        if path != self.root and self.root not in path.parents:
            raise ValueError("artifact path is outside configured root")
        return path.read_bytes()
