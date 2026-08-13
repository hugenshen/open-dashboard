"""OpenAI-compatible chat client for OD Lead Agent."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional


def llm_configured() -> bool:
    key = (os.environ.get("OD_LLM_API_KEY") or os.environ.get("OPENAI_API_KEY") or "").strip()
    return bool(key)


def llm_settings() -> Dict[str, Any]:
    return {
        "base_url": (os.environ.get("OD_LLM_BASE_URL") or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/"),
        "api_key": (os.environ.get("OD_LLM_API_KEY") or os.environ.get("OPENAI_API_KEY") or "").strip(),
        "model": os.environ.get("OD_LLM_MODEL") or os.environ.get("OPENAI_MODEL") or "gpt-4o-mini",
        "timeout_s": float(os.environ.get("OD_LLM_TIMEOUT_S") or "120"),
    }


def chat_completions(
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]] = None,
    temperature: float = 0.2,
) -> Dict[str, Any]:
    cfg = llm_settings()
    if not cfg["api_key"]:
        raise RuntimeError("LLM API key missing (set OD_LLM_API_KEY or OPENAI_API_KEY)")

    body: Dict[str, Any] = {
        "model": cfg["model"],
        "messages": messages,
        "temperature": temperature,
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"

    req = urllib.request.Request(
        f"{cfg['base_url']}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg['api_key']}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=cfg["timeout_s"]) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LLM HTTP {e.code}: {err[:500]}") from e
