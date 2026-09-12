from __future__ import annotations

from typing import Any

from sevenonic_mail.domain import IngestedEvent
from sevenonic_mail.services.monday_writer import MondayWriter
from sevenonic_mail.services.sync import MailSyncService, SubscriptionService
from sevenonic_mail.storage.database import Repository


class JobRunner:
    def __init__(
        self,
        repository: Repository,
        *,
        sync_service: MailSyncService | None,
        monday_writer: MondayWriter | None,
        subscription_service: SubscriptionService | None = None,
    ) -> None:
        self.repository = repository
        self.sync_service = sync_service
        self.monday_writer = monday_writer
        self.subscription_service = subscription_service

    async def run_once(self, limit: int = 10) -> dict[str, int]:
        claimed = self.repository.claim_ready_jobs(limit)
        succeeded = 0
        failed = 0
        for job in claimed:
            try:
                await self._execute(job)
                self.repository.finish_job(int(job["id"]))
                succeeded += 1
            except Exception as exc:
                self.repository.fail_job(int(job["id"]), str(exc))
                failed += 1
        return {"claimed": len(claimed), "succeeded": succeeded, "failed": failed}

    async def _execute(self, job: dict[str, Any]) -> None:
        payload = dict(job["payload"])
        if job["job_type"] == "SYNC_MAILBOX":
            if not self.sync_service:
                raise RuntimeError("Graph is not configured")
            await self.sync_service.sync(str(payload["mailbox_id"]), str(payload["folder_id"]))
            return
        if job["job_type"] == "WRITE_MONDAY":
            if not self.monday_writer:
                raise RuntimeError("monday is not configured")
            row = self.repository.get_event(str(payload["event_id"]))
            if not row:
                raise RuntimeError(f"business event {payload['event_id']} does not exist")
            event = IngestedEvent(
                event_id=str(row["event_id"]),
                event_type=str(row["event_type"]),
                customer_id=str(row["customer_id"]),
                business_key=str(row["business_key"]),
                revision=int(row["revision"]),
                payload=dict(row["payload"]),
                source_mail_copy_id=0,
            )
            await self.monday_writer.ensure_review_item(event)
            return
        if job["job_type"] == "RENEW_SUBSCRIPTION":
            if not self.subscription_service:
                raise RuntimeError("Graph subscriptions are not configured")
            await self.subscription_service.renew(
                str(payload["mailbox_id"]), str(payload["folder_id"])
            )
            return
        if job["job_type"] == "RECREATE_SUBSCRIPTION":
            if not self.subscription_service:
                raise RuntimeError("Graph subscriptions are not configured")
            await self.subscription_service.create(
                str(payload["mailbox_id"]), str(payload["folder_id"])
            )
            return
        if job["job_type"] == "MONDAY_RECONCILE":
            # Notification is only a wake-up signal. Full role transition handling is added
            # after the real board schema and actor permissions are supplied by the customer.
            return
        raise RuntimeError(f"unsupported job type {job['job_type']}")
