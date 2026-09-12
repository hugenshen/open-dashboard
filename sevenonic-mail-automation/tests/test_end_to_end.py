from __future__ import annotations

import httpx
import pytest
from conftest import build_mime, build_tech_pack

from sevenonic_mail.app import build_container
from sevenonic_mail.clients.graph import GraphClient
from sevenonic_mail.clients.monday import MondayClient


class StaticToken:
    async def get_token(self) -> str:
        return "graph-token"


@pytest.mark.asyncio
async def test_graph_mail_with_garment_excel_reaches_monday_once(settings) -> None:
    raw_mime = build_mime(build_tech_pack())
    graph_calls: list[str] = []
    monday_calls: list[str] = []

    def graph_handler(request: httpx.Request) -> httpx.Response:
        graph_calls.append(str(request.url))
        if request.url.path.endswith("/$value"):
            assert request.headers["prefer"] == 'IdType="ImmutableId"'
            return httpx.Response(200, content=raw_mime, headers={"Content-Type": "message/rfc822"})
        if request.url.path.endswith("/messages/delta"):
            return httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "id": "IMM-HMV071-R4",
                            "internetMessageId": "<hmv071-r4@customer-a.com>",
                            "subject": "HMV071 Tech Pack Rev 4",
                            "hasAttachments": True,
                            "receivedDateTime": "2026-09-12T02:00:00Z",
                            "lastModifiedDateTime": "2026-09-12T02:00:01Z",
                        }
                    ],
                    "@odata.deltaLink": "https://graph.test/v1.0/delta/token-1",
                },
            )
        if request.url.path == "/v1.0/delta/token-1":
            return httpx.Response(
                200,
                json={
                    "value": [],
                    "@odata.deltaLink": "https://graph.test/v1.0/delta/token-2",
                },
            )
        raise AssertionError(f"unexpected Graph request {request.url}")

    def monday_handler(request: httpx.Request) -> httpx.Response:
        body = request.content.decode()
        monday_calls.append(body)
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
        if "CreateReviewItem" in body:
            assert request.headers["idempotency-key"]
            assert "HMV071" in body
            return httpx.Response(200, json={"data": {"create_item": {"id": "item-100"}}})
        raise AssertionError("unexpected monday request")

    async with (
        httpx.AsyncClient(transport=httpx.MockTransport(graph_handler)) as graph_http,
        httpx.AsyncClient(transport=httpx.MockTransport(monday_handler)) as monday_http,
    ):
        graph = GraphClient(StaticToken(), http=graph_http, base_url="https://graph.test/v1.0")
        monday = MondayClient("monday-token", http=monday_http, endpoint="https://monday.test/v2")
        container = build_container(settings, graph=graph, monday=monday)
        container.repository.enqueue_job(
            "SYNC_MAILBOX",
            "po@sevenonic.com|inbox",
            {"mailbox_id": "po@sevenonic.com", "folder_id": "inbox"},
        )

        first = await container.job_runner.run_once()
        second = await container.job_runner.run_once()
        # A later duplicate wake-up follows the cursor and must not create another event/item.
        container.repository.enqueue_job(
            "SYNC_MAILBOX",
            "po@sevenonic.com|inbox",
            {"mailbox_id": "po@sevenonic.com", "folder_id": "inbox"},
        )
        third = await container.job_runner.run_once()

    assert first == {"claimed": 1, "succeeded": 1, "failed": 0}
    assert second == {"claimed": 1, "succeeded": 1, "failed": 0}
    assert third == {"claimed": 1, "succeeded": 1, "failed": 0}
    counts = container.repository.counts()
    assert counts["mail_copies"] == 1
    assert counts["artifacts"] == 1
    assert counts["canonical_messages"] == 1
    assert counts["business_events"] == 1
    assert counts["extraction_runs"] == 1
    assert counts["write_operations"] == 1
    assert len(monday_calls) == 3
    assert any("/$value" in call for call in graph_calls)


@pytest.mark.asyncio
async def test_two_mailbox_copies_form_one_business_event(settings) -> None:
    raw_mime = build_mime(build_tech_pack())
    container = build_container(settings)
    from sevenonic_mail.domain import DeltaMessage

    message_one = DeltaMessage(
        immutable_id="IMM-PO-1",
        internet_message_id="<hmv071-r4@customer-a.com>",
        subject="HMV071 Tech Pack Rev 4",
        received_at=None,
        last_modified_at=None,
        has_attachments=True,
        raw={},
    )
    message_two = DeltaMessage(
        immutable_id="IMM-BOSS-9",
        internet_message_id="<hmv071-r4@customer-a.com>",
        subject="HMV071 Tech Pack Rev 4",
        received_at=None,
        last_modified_at=None,
        has_attachments=True,
        raw={},
    )

    first = container.ingestion.ingest(
        mailbox_id="po@sevenonic.com",
        folder_id="inbox",
        delta_message=message_one,
        raw_mime=raw_mime,
    )
    second = container.ingestion.ingest(
        mailbox_id="boss@sevenonic.com",
        folder_id="inbox",
        delta_message=message_two,
        raw_mime=raw_mime,
    )

    assert len(first) == 1
    assert second == []
    counts = container.repository.counts()
    assert counts["mail_copies"] == 2
    assert counts["canonical_messages"] == 1
    assert counts["business_events"] == 1
