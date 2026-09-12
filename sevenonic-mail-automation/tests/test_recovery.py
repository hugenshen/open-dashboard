from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from sevenonic_mail.clients.graph import GraphError
from sevenonic_mail.clients.monday import MondayClient
from sevenonic_mail.domain import DeltaBatch, DeltaMessage, IngestedEvent
from sevenonic_mail.services.jobs import JobRunner
from sevenonic_mail.services.monday_writer import MondayWriter
from sevenonic_mail.services.sync import MailSyncService, SubscriptionService
from sevenonic_mail.storage.database import Repository, jobs


class SubscriptionGraphStub:
    def __init__(self) -> None:
        self.created = 0
        self.renewed: list[str] = []

    @staticmethod
    def resource(mailbox_id: str, folder_id: str) -> str:
        return f"users/{mailbox_id}/mailFolders/{folder_id}/messages"

    async def create_subscription(self, **_: object) -> dict[str, str]:
        self.created += 1
        return {
            "id": "sub-created",
            "resource": "users/po@sevenonic.com/mailFolders/inbox/messages",
            "expirationDateTime": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
        }

    async def renew_subscription(self, subscription_id: str) -> dict[str, str]:
        self.renewed.append(subscription_id)
        return {
            "id": subscription_id,
            "expirationDateTime": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
        }


@pytest.mark.asyncio
async def test_subscription_ensure_reuses_healthy_and_renews_expiring(tmp_path) -> None:
    repository = Repository(f"sqlite:///{tmp_path / 'subscriptions.db'}")
    repository.create_schema()
    graph = SubscriptionGraphStub()
    service = SubscriptionService(
        repository,
        graph,  # type: ignore[arg-type]
        notification_url="https://example.test/webhooks/graph",
        lifecycle_url="https://example.test/webhooks/graph/lifecycle",
        client_state="secret",
    )
    repository.upsert_subscription(
        mailbox_id="po@sevenonic.com",
        folder_id="inbox",
        resource=graph.resource("po@sevenonic.com", "inbox"),
        remote_id="sub-1",
        expires_at=datetime.now(UTC) + timedelta(days=2),
    )

    healthy = await service.ensure("po@sevenonic.com", "inbox")
    assert healthy["reused"] is True
    assert graph.renewed == []

    repository.upsert_subscription(
        mailbox_id="po@sevenonic.com",
        folder_id="inbox",
        resource=graph.resource("po@sevenonic.com", "inbox"),
        remote_id="sub-1",
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    renewed = await service.ensure("po@sevenonic.com", "inbox")

    assert renewed["id"] == "sub-1"
    assert graph.renewed == ["sub-1"]
    assert graph.created == 0


class CursorResetGraphStub:
    def __init__(self) -> None:
        self.cursors: list[str | None] = []

    async def delta_messages(
        self, mailbox_id: str, folder_id: str, delta_link: str | None
    ) -> DeltaBatch:
        self.cursors.append(delta_link)
        if delta_link:
            raise GraphError("expired sync token", status_code=410)
        return DeltaBatch(messages=[], delta_link=f"fresh:{mailbox_id}:{folder_id}")


@pytest.mark.asyncio
async def test_delta_410_rebuilds_only_the_current_mailbox_folder_scope(tmp_path) -> None:
    repository = Repository(f"sqlite:///{tmp_path / 'cursor.db'}")
    repository.create_schema()
    repository.set_cursor("po@sevenonic.com", "inbox", "old-po-inbox")
    repository.set_cursor("merch@sevenonic.com", "inbox", "old-merch-inbox")
    graph = CursorResetGraphStub()
    service = MailSyncService(repository, graph, ingestion=object())  # type: ignore[arg-type]

    await service.sync("po@sevenonic.com", "inbox")

    assert graph.cursors == ["old-po-inbox", None]
    assert repository.get_cursor("po@sevenonic.com", "inbox") == ("fresh:po@sevenonic.com:inbox")
    assert repository.get_cursor("merch@sevenonic.com", "inbox") == "old-merch-inbox"


class MimeFailureGraphStub:
    async def delta_messages(
        self, mailbox_id: str, folder_id: str, delta_link: str | None
    ) -> DeltaBatch:
        del mailbox_id, folder_id, delta_link
        return DeltaBatch(
            messages=[
                DeltaMessage(
                    immutable_id="IMM-FAIL",
                    internet_message_id="<fail@example.com>",
                    subject="broken MIME",
                    received_at=None,
                    last_modified_at=None,
                    has_attachments=True,
                    raw={},
                )
            ],
            delta_link="new-cursor-that-must-not-be-committed",
        )

    async def get_mime(self, mailbox_id: str, immutable_id: str) -> bytes:
        del mailbox_id, immutable_id
        raise GraphError("temporary download failure", status_code=503)


@pytest.mark.asyncio
async def test_mime_failure_does_not_advance_delta_cursor(tmp_path) -> None:
    repository = Repository(f"sqlite:///{tmp_path / 'mime-failure.db'}")
    repository.create_schema()
    repository.set_cursor("po@sevenonic.com", "inbox", "last-good-cursor")
    service = MailSyncService(
        repository,
        MimeFailureGraphStub(),  # type: ignore[arg-type]
        ingestion=object(),  # type: ignore[arg-type]
    )

    with pytest.raises(GraphError, match="temporary download failure"):
        await service.sync("po@sevenonic.com", "inbox")

    assert repository.get_cursor("po@sevenonic.com", "inbox") == "last-good-cursor"


class FolderMoveGraphStub:
    async def delta_messages(
        self, mailbox_id: str, folder_id: str, delta_link: str | None
    ) -> DeltaBatch:
        del mailbox_id, delta_link
        return DeltaBatch(
            messages=[
                DeltaMessage(
                    immutable_id="IMM-MOVED",
                    internet_message_id="<moved@example.com>",
                    subject="same message in archive",
                    received_at=None,
                    last_modified_at=None,
                    has_attachments=False,
                    raw={},
                )
            ],
            delta_link=f"cursor:{folder_id}",
        )

    async def get_mime(self, mailbox_id: str, immutable_id: str) -> bytes:
        del mailbox_id, immutable_id
        raise AssertionError("existing immutable mail must not be downloaded again")


@pytest.mark.asyncio
async def test_same_mail_moved_between_folders_updates_presence_without_reparse(tmp_path) -> None:
    repository = Repository(f"sqlite:///{tmp_path / 'folder-move.db'}")
    repository.create_schema()
    repository.upsert_mail_copy(
        {
            "mailbox_id": "po@sevenonic.com",
            "folder_id": "inbox",
            "current_folder_id": "inbox",
            "immutable_id": "IMM-MOVED",
            "internet_message_id": "<moved@example.com>",
            "subject": "same message in inbox",
            "sender": "buyer@example.com",
            "received_at": None,
            "mime_sha256": "a" * 64,
            "archive_uri": "file:///archive/message.eml",
            "graph_presence": "REMOVED_FROM_FOLDER",
            "archive_status": "FULLY_ARCHIVED",
            "security_status": "NOT_SCANNED",
        }
    )
    service = MailSyncService(
        repository,
        FolderMoveGraphStub(),  # type: ignore[arg-type]
        ingestion=object(),  # type: ignore[arg-type]
    )

    result = await service.sync("po@sevenonic.com", "archive")

    copy = repository.get_mail_copy("po@sevenonic.com", "IMM-MOVED")
    assert result["ingested"] == 0
    assert copy is not None
    assert copy["current_folder_id"] == "archive"
    assert copy["graph_presence"] == "PRESENT"


@pytest.mark.asyncio
async def test_failed_job_is_retried_and_keeps_its_active_dedupe_key(tmp_path) -> None:
    repository = Repository(f"sqlite:///{tmp_path / 'jobs.db'}")
    repository.create_schema()
    assert repository.enqueue_job("UNSUPPORTED", "same-event", {"event_id": "evt-1"})
    runner = JobRunner(repository, sync_service=None, monday_writer=None)

    result = await runner.run_once()

    assert result == {"claimed": 1, "succeeded": 0, "failed": 1}
    with repository.engine.connect() as connection:
        row = connection.execute(select(jobs)).mappings().one()
    assert row["status"] == "READY"
    assert row["attempt"] == 1
    assert row["active_key"] == "UNSUPPORTED|same-event"
    assert row["run_after"] > row["updated_at"]
    assert not repository.enqueue_job("UNSUPPORTED", "same-event", {"event_id": "evt-1"})


@pytest.mark.asyncio
async def test_monday_schema_mismatch_stops_before_remote_write(tmp_path) -> None:
    operations: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.content.decode()
        if "BoardSchema" in body:
            operations.append("schema")
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
                                ],
                            }
                        ]
                    }
                },
            )
        operations.append("unexpected-write")
        return httpx.Response(500)

    repository = Repository(f"sqlite:///{tmp_path / 'monday-schema.db'}")
    repository.create_schema()
    event = IngestedEvent(
        event_id="evt-schema",
        event_type="TECH_PACK",
        customer_id="customer-a.com",
        business_key="TECH_PACK|customer-a.com|HMV071|R4",
        revision=4,
        payload={"style_no": "HMV071"},
        source_mail_copy_id=1,
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        writer = MondayWriter(
            repository,
            MondayClient("token", http=http, endpoint="https://monday.test/v2"),
            board_id="18430298578",
            group_id="ai_review",
            event_column_id="event_id",
            style_column_id="style_id",
            revision_column_id="tech_pack_revision",
            review_status_column_id="review_status",
            review_status_label="待人工复核",
        )
        with pytest.raises(RuntimeError, match="review_status"):
            await writer.ensure_review_item(event)

    assert operations == ["schema"]
    assert repository.counts()["write_operations"] == 0
