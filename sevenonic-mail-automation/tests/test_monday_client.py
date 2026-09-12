from __future__ import annotations

import httpx
import pytest

from sevenonic_mail.clients.monday import MondayClient, MondayError
from sevenonic_mail.domain import IngestedEvent
from sevenonic_mail.services.monday_writer import MondayWriter
from sevenonic_mail.storage.database import Repository


@pytest.mark.asyncio
async def test_monday_writer_queries_then_creates_once_with_idempotency(tmp_path) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        body = request.content.decode()
        if "BoardSchema" in body:
            return httpx.Response(
                200,
                json={
                    "data": {
                        "boards": [
                            {
                                "id": "18430298578",
                                "groups": [{"id": "ai_review", "title": "AI Review"}],
                                "columns": [
                                    {"id": "event_id", "type": "text"},
                                    {"id": "style_id", "type": "text"},
                                    {"id": "tech_pack_revision", "type": "numbers"},
                                    {"id": "review_status", "type": "status"},
                                ],
                            }
                        ]
                    }
                },
            )
        if "FindItem" in body:
            return httpx.Response(
                200,
                json={"data": {"items_page_by_column_values": {"items": []}}},
            )
        assert request.headers.get("idempotency-key")
        return httpx.Response(200, json={"data": {"create_item": {"id": "item-100"}}})

    repository = Repository(f"sqlite:///{tmp_path / 'monday.db'}")
    repository.create_schema()
    event = IngestedEvent(
        event_id="evt-1",
        event_type="TECH_PACK",
        customer_id="customer-a.com",
        business_key="TECH_PACK|customer-a.com|HMV071|R4",
        revision=4,
        payload={"style_no": "HMV071", "revision": 4},
        source_mail_copy_id=1,
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = MondayClient("monday-token", http=http, endpoint="https://monday.test/v2")
        writer = MondayWriter(
            repository,
            client,
            board_id="18430298578",
            group_id="ai_review",
            event_column_id="event_id",
            style_column_id="style_id",
            revision_column_id="tech_pack_revision",
            review_status_column_id="review_status",
            review_status_label="待人工复核",
        )
        first = await writer.ensure_review_item(event)
        second = await writer.ensure_review_item(event)

    assert first.item_id == "item-100"
    assert first.created is True
    assert second.item_id == "item-100"
    assert second.created is False
    assert len(calls) == 3


@pytest.mark.asyncio
async def test_monday_http_200_with_graphql_errors_is_failure() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"errors": [{"message": "invalid column"}], "data": {}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = MondayClient("token", http=http, endpoint="https://monday.test/v2")
        with pytest.raises(MondayError, match="invalid column"):
            await client.board_schema("18430298578")
