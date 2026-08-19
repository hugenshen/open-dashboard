"""Request-scoped identity for the harness (DeerFlow-style ContextVar).

The client must not declare user_id / owner_id in JSON bodies. Identity comes
from X-User-Id / X-User-Perms headers (Auth SPI), matching Java HeaderAuthProvider.
"""

from __future__ import annotations

import os
from contextvars import ContextVar
from typing import Optional

_user_id: ContextVar[Optional[str]] = ContextVar("od_user_id", default=None)
_perms: ContextVar[str] = ContextVar("od_user_perms", default="")
_workspace_id: ContextVar[str] = ContextVar("od_workspace_id", default="default")


def allow_anon() -> bool:
    raw = (os.environ.get("OD_HARNESS_ALLOW_ANON") or "true").strip().lower()
    return raw in ("1", "true", "yes", "on")


def set_principal(user_id: Optional[str], perms: Optional[str] = None) -> str:
    uid = (user_id or "").strip()
    raw_perms = (perms or "").strip()
    if not uid:
        if not allow_anon():
            raise PermissionError("principal required")
        uid = "demo"
        if not raw_perms:
            raw_perms = "*"
    _user_id.set(uid)
    _perms.set(raw_perms)
    return uid


def set_workspace(workspace_id: Optional[str]) -> str:
    wid = (workspace_id or "").strip() or "default"
    if "/" in wid or "\\" in wid or wid in (".", ".."):
        raise PermissionError("invalid workspace id")
    _workspace_id.set(wid)
    return wid


def clear_principal() -> None:
    _user_id.set(None)
    _perms.set("")
    _workspace_id.set("default")


def current_user_id() -> Optional[str]:
    return _user_id.get()


def current_perms() -> str:
    return _perms.get() or ""


def current_workspace_id() -> str:
    return _workspace_id.get() or "default"


def require_user_id() -> str:
    uid = current_user_id()
    if uid:
        return uid
    if allow_anon():
        return set_principal("demo", "*")
    raise PermissionError("principal required")


def has_permission(code: str) -> bool:
    raw = current_perms()
    if not raw:
        return allow_anon()
    parts = {p.strip() for p in raw.split(",") if p.strip()}
    if "*" in parts or code in parts:
        return True
    if ":" in code:
        wildcard = code.split(":", 1)[0] + ":*"
        if wildcard in parts:
            return True
    return False
