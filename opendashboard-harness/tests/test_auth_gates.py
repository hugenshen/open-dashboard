import pytest
from pydantic import ValidationError

from agent.user_context import clear_principal, set_principal
from api.app import CreateConversationBody, RunBody
from tools.gateway import QUERY_TOOLS, WRITE_TOOLS, ToolGateway


def setup_function():
    clear_principal()


def teardown_function():
    clear_principal()


def test_create_conversation_rejects_body_user_id():
    with pytest.raises(ValidationError):
        CreateConversationBody(title="x", userId="attacker")


def test_create_conversation_rejects_body_owner_id():
    with pytest.raises(ValidationError):
        CreateConversationBody(title="x", ownerId="attacker")


def test_run_body_rejects_user_id():
    with pytest.raises(ValidationError):
        RunBody(message="GMV", userId="attacker")


def test_query_tools_require_ask_permissions():
    set_principal("viewer", "report:view")
    gateway = ToolGateway.create(user_id="viewer", workspace_id="ws-a")
    names = {tool.name for tool in gateway.tools}
    assert QUERY_TOOLS.isdisjoint(names)
    result = gateway.execute("od_run_sql", {"sql": "select 1", "datasetId": "ds"})
    assert result["error"] == "TOOL_FORBIDDEN"


def test_write_tools_require_dashboard_manage():
    set_principal("analyst", "conversation:use,dataset:use")
    gateway = ToolGateway.create(user_id="analyst", workspace_id="ws-a")
    names = {tool.name for tool in gateway.tools}
    assert WRITE_TOOLS.isdisjoint(names)
    assert "od_run_sql" in names
