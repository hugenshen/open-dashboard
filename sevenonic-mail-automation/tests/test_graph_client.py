from __future__ import annotations

import json

import httpx
import pytest

from sevenonic_mail.clients.graph import GraphClient


class StaticToken:
    async def get_token(self) -> str:
        return "graph-token"


@pytest.mark.asyncio
async def test_graph_delta_follows_pages_and_requests_immutable_ids() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["authorization"] == "Bearer graph-token"
        assert request.headers["prefer"] == 'IdType="ImmutableId"'
        if request.url.path.endswith("/messages/delta"):
            return httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "id": "IMM-1",
                            "internetMessageId": "<one@example.com>",
                            "subject": "first",
                            "hasAttachments": True,
                        }
                    ],
                    "@odata.nextLink": "https://graph.test/v1.0/next/page-2",
                },
            )
        return httpx.Response(
            200,
            json={
                "value": [{"id": "IMM-2", "subject": "deleted", "@removed": {"reason": "deleted"}}],
                "@odata.deltaLink": "https://graph.test/v1.0/delta/token-1",
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = GraphClient(StaticToken(), http=http, base_url="https://graph.test/v1.0")
        batch = await client.delta_messages("po@sevenonic.com", "inbox")

    assert [item.immutable_id for item in batch.messages] == ["IMM-1", "IMM-2"]
    assert batch.messages[1].removed_reason == "deleted"
    assert batch.delta_link.endswith("token-1")
    assert len(requests) == 2


@pytest.mark.asyncio
async def test_graph_subscription_payload_uses_real_resource_and_client_state() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(
            201,
            json={
                "id": "sub-1",
                "resource": captured["resource"],
                "expirationDateTime": captured["expirationDateTime"],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = GraphClient(StaticToken(), http=http, base_url="https://graph.test/v1.0")
        result = await client.create_subscription(
            mailbox_id="po@sevenonic.com",
            folder_id="inbox",
            notification_url="https://example.test/webhooks/graph",
            lifecycle_url="https://example.test/webhooks/graph/lifecycle",
            client_state="random-secret",
        )

    assert result["id"] == "sub-1"
    assert captured["changeType"] == "created,updated,deleted"
    assert captured["resource"] == "users/po@sevenonic.com/mailFolders/inbox/messages"
    assert captured["clientState"] == "random-secret"


@pytest.mark.asyncio
async def test_graph_mail_folder_probe_resolves_real_folder_id() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/mailFolders/inbox")
        return httpx.Response(
            200,
            json={
                "id": "AAMk-real-folder-id",
                "displayName": "Inbox",
                "totalItemCount": 762,
                "unreadItemCount": 4,
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = GraphClient(StaticToken(), http=http, base_url="https://graph.test/v1.0")
        folder = await client.mail_folder("po@sevenonic.com", "inbox")

    assert folder["id"] == "AAMk-real-folder-id"
    assert folder["totalItemCount"] == 762
