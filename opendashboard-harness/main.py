"""Open Dashboard AI harness — Pi-style Agent runtime (FE direct).

Java is zero-AI BI. This process owns session + Agent loop + tools.
"""

from __future__ import annotations

import os

from env_loader import load_dotenv

load_dotenv()

from api.app import app  # noqa: E402

HARNESS_PORT = int(os.environ.get("OD_HARNESS_PORT", "8091"))
HARNESS_HOST = os.environ.get("OD_HARNESS_HOST", "0.0.0.0")

__all__ = ["app"]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=HARNESS_HOST, port=HARNESS_PORT, reload=False)
