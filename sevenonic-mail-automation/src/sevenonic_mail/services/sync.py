from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sevenonic_mail.clients.graph import GraphClient, GraphError
from sevenonic_mail.services.ingestion import MailIngestionService
from sevenonic_mail.storage.database import Repository


class SubscriptionService:
    def __init__(
        self,
        repository: Repository,
        graph: GraphClient,
        *,
        notification_url: str,
        lifecycle_url: str,
        client_state: str,
    ) -> None:
        self.repository = repository
        self.graph = graph
        self.notification_url = notification_url
        self.lifecycle_url = lifecycle_url
        self.client_state = client_state

    async def create(self, mailbox_id: str, folder_id: str) -> dict[str, Any]:
        subscription = await self.graph.create_subscription(
            mailbox_id=mailbox_id,
            folder_id=folder_id,
            notification_url=self.notification_url,
            lifecycle_url=self.lifecycle_url,
            client_state=self.client_state,
        )
        expires_at = subscription.get("expirationDateTime")
        parsed_expiration = (
            datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) if expires_at else None
        )
        self.repository.upsert_subscription(
            mailbox_id=mailbox_id,
            folder_id=folder_id,
            resource=str(
                subscription.get("resource") or self.graph.resource(mailbox_id, folder_id)
            ),
            remote_id=str(subscription["id"]),
            expires_at=parsed_expiration,
        )
        return subscription

    async def ensure(self, mailbox_id: str, folder_id: str) -> dict[str, Any]:
        existing = self.repository.get_subscription(mailbox_id, folder_id)
        if not existing or not existing.get("remote_id"):
            return await self.create(mailbox_id, folder_id)
        expires_at = existing.get("expires_at")
        if isinstance(expires_at, datetime):
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            if expires_at > datetime.now(UTC) + timedelta(hours=24):
                return {
                    "id": existing["remote_id"],
                    "resource": existing["resource"],
                    "expirationDateTime": expires_at.isoformat().replace("+00:00", "Z"),
                    "reused": True,
                }
        return await self.renew(mailbox_id, folder_id)

    async def renew(self, mailbox_id: str, folder_id: str) -> dict[str, Any]:
        existing = self.repository.get_subscription(mailbox_id, folder_id)
        if not existing or not existing.get("remote_id"):
            return await self.create(mailbox_id, folder_id)
        response = await self.graph.renew_subscription(str(existing["remote_id"]))
        renewed_expiration = response.get("expirationDateTime")
        parsed_expiration = (
            datetime.fromisoformat(str(renewed_expiration).replace("Z", "+00:00"))
            if renewed_expiration
            else None
        )
        self.repository.upsert_subscription(
            mailbox_id=mailbox_id,
            folder_id=folder_id,
            resource=str(existing["resource"]),
            remote_id=str(existing["remote_id"]),
            expires_at=parsed_expiration,
        )
        return response

    async def renew_due(self, renew_before_seconds: int = 86_400) -> dict[str, int]:
        cutoff = datetime.now(UTC) + timedelta(seconds=renew_before_seconds)
        due = self.repository.subscriptions_expiring_before(cutoff)
        renewed = 0
        failed = 0
        for subscription in due:
            try:
                response = await self.graph.renew_subscription(str(subscription["remote_id"]))
                expires_at = response.get("expirationDateTime")
                parsed_expiration = (
                    datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                    if expires_at
                    else None
                )
                self.repository.upsert_subscription(
                    mailbox_id=str(subscription["mailbox_id"]),
                    folder_id=str(subscription["folder_id"]),
                    resource=str(subscription["resource"]),
                    remote_id=str(subscription["remote_id"]),
                    expires_at=parsed_expiration,
                )
                renewed += 1
            except Exception:
                failed += 1
        return {"due": len(due), "renewed": renewed, "failed": failed}


class MailSyncService:
    def __init__(
        self,
        repository: Repository,
        graph: GraphClient,
        ingestion: MailIngestionService,
    ) -> None:
        self.repository = repository
        self.graph = graph
        self.ingestion = ingestion

    async def sync(self, mailbox_id: str, folder_id: str) -> dict[str, int | str]:
        old_cursor = self.repository.get_cursor(mailbox_id, folder_id)
        try:
            batch = await self.graph.delta_messages(mailbox_id, folder_id, old_cursor)
        except GraphError as exc:
            if not old_cursor or exc.status_code != 410:
                raise
            # Graph can invalidate a sync token. Rebuild only this mailbox/folder scope.
            batch = await self.graph.delta_messages(mailbox_id, folder_id, None)
        ingested = 0
        events = 0
        removed = 0
        for message in batch.messages:
            if message.removed_reason:
                self.repository.mark_mail_removed(mailbox_id, message.immutable_id, folder_id)
                removed += 1
                continue
            existing = self.repository.get_mail_copy(mailbox_id, message.immutable_id)
            if existing:
                # ImmutableId identifies the same mail copy after a folder move.
                # Update presence/folder without downloading or parsing it again.
                self.repository.mark_mail_present(mailbox_id, message.immutable_id, folder_id)
                continue
            raw_mime = await self.graph.get_mime(mailbox_id, message.immutable_id)
            new_events = self.ingestion.ingest(
                mailbox_id=mailbox_id,
                folder_id=folder_id,
                delta_message=message,
                raw_mime=raw_mime,
            )
            ingested += 1
            events += len(new_events)

        # Cursor advances after every page and artifact is durable.
        # monday is an independent outbox job.
        self.repository.set_cursor(mailbox_id, folder_id, batch.delta_link)
        return {
            "mailbox_id": mailbox_id,
            "folder_id": folder_id,
            "ingested": ingested,
            "removed": removed,
            "events": events,
            "monday_items": 0,
        }
