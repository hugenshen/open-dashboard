import os

from agent.user_context import allow_anon, current_workspace_id, has_permission, set_principal, set_workspace


def test_allow_anon_default(monkeypatch):
    monkeypatch.delenv("OD_HARNESS_ALLOW_ANON", raising=False)
    assert allow_anon() is True
    monkeypatch.setenv("OD_HARNESS_ALLOW_ANON", "false")
    assert allow_anon() is False


def test_set_principal_required(monkeypatch):
    monkeypatch.setenv("OD_HARNESS_ALLOW_ANON", "false")
    try:
        set_principal(None)
        raise AssertionError("expected PermissionError")
    except PermissionError:
        pass
    uid = set_principal("alice", "conversation:use,dataset:use")
    assert uid == "alice"
    assert has_permission("dataset:use")
    assert not has_permission("dashboard:manage")


def test_anon_fallback_gets_star_perms(monkeypatch):
    monkeypatch.delenv("OD_HARNESS_ALLOW_ANON", raising=False)
    uid = set_principal(None)
    assert uid == "demo"
    assert has_permission("dataset:use")


def test_workspace_context_defaults_and_validates():
    assert set_workspace(None) == "default"
    assert current_workspace_id() == "default"
    assert set_workspace("ws-a") == "ws-a"
    assert current_workspace_id() == "ws-a"
    try:
        set_workspace("../bad")
        raise AssertionError("expected PermissionError")
    except PermissionError:
        pass
