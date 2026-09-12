from __future__ import annotations

import hashlib
import json
import time

from sevenonic_mail.clients.monday import MondayClient
from sevenonic_mail.domain import IngestedEvent, MondayWriteResult
from sevenonic_mail.storage.database import Repository


class MondayWriter:
    action = "CREATE_REVIEW_DRAFT"

    def __init__(
        self,
        repository: Repository,
        client: MondayClient,
        *,
        board_id: str,
        group_id: str,
        event_column_id: str,
        style_column_id: str,
        revision_column_id: str,
        review_status_column_id: str,
        review_status_label: str,
        schema_cache_seconds: int = 300,
    ) -> None:
        self.repository = repository
        self.client = client
        self.board_id = board_id
        self.group_id = group_id
        self.event_column_id = event_column_id
        self.style_column_id = style_column_id
        self.revision_column_id = revision_column_id
        self.review_status_column_id = review_status_column_id
        self.review_status_label = review_status_label
        self.schema_cache_seconds = schema_cache_seconds
        self._schema_checked_at = 0.0

    async def _ensure_schema(self) -> None:
        now = time.monotonic()
        if now - self._schema_checked_at < self.schema_cache_seconds:
            return
        schema = await self.client.board_schema(self.board_id)
        groups = {str(group["id"]) for group in schema.get("groups", [])}
        if self.group_id not in groups:
            raise RuntimeError(f"monday group {self.group_id} does not exist")
        columns = {str(column["id"]): str(column["type"]) for column in schema.get("columns", [])}
        expected = {
            self.event_column_id: {"text"},
            self.style_column_id: {"text"},
            self.revision_column_id: {"numbers", "text"},
            self.review_status_column_id: {"status"},
        }
        for column_id, allowed_types in expected.items():
            actual_type = columns.get(column_id)
            if actual_type not in allowed_types:
                raise RuntimeError(
                    f"monday column {column_id} expected {sorted(allowed_types)}, "
                    f"received {actual_type or 'missing'}"
                )
        self._schema_checked_at = now

    @staticmethod
    def _hash(data: dict[str, object]) -> str:
        encoded = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode()).hexdigest()

    def _column_values(self, event: IngestedEvent) -> dict[str, object]:
        style = event.payload.get("style_no") or event.payload.get("po_no") or event.event_id
        return {
            self.event_column_id: event.event_id,
            self.style_column_id: str(style),
            self.revision_column_id: event.revision,
            self.review_status_column_id: {"label": self.review_status_label},
        }

    async def ensure_review_item(self, event: IngestedEvent) -> MondayWriteResult:
        await self._ensure_schema()
        columns = self._column_values(event)
        payload = {
            "board_id": self.board_id,
            "group_id": self.group_id,
            "item_name": event.payload.get("style_no")
            or event.payload.get("po_no")
            or event.business_key,
            "column_values": columns,
        }
        payload_hash = self._hash(payload)
        target = f"monday:board:{self.board_id}"
        idempotency_key = hashlib.sha256(
            f"{target}|{event.event_id}|{self.action}|{payload_hash}".encode()
        ).hexdigest()
        operation = self.repository.begin_write_operation(
            target=target,
            event_id=event.event_id,
            action=self.action,
            payload_hash=payload_hash,
            idempotency_key=idempotency_key,
        )
        if operation["status"] == "SUCCEEDED" and operation.get("remote_item_id"):
            return MondayWriteResult(
                item_id=str(operation["remote_item_id"]),
                created=False,
                payload_hash=payload_hash,
            )

        remote_item_id = await self.client.find_item_by_event_id(
            self.board_id, self.event_column_id, event.event_id
        )
        if remote_item_id:
            self.repository.update_write_operation(
                int(operation["id"]), "SUCCEEDED", remote_item_id=remote_item_id
            )
            return MondayWriteResult(
                item_id=remote_item_id, created=False, payload_hash=payload_hash
            )

        self.repository.update_write_operation(int(operation["id"]), "SENT")
        try:
            item_id = await self.client.create_item(
                board_id=self.board_id,
                group_id=self.group_id,
                item_name=str(payload["item_name"]),
                column_values=columns,
                idempotency_key=idempotency_key,
            )
        except Exception as exc:
            self.repository.update_write_operation(int(operation["id"]), "UNKNOWN", error=str(exc))
            raise
        self.repository.update_write_operation(
            int(operation["id"]), "SUCCEEDED", remote_item_id=item_id
        )
        return MondayWriteResult(item_id=item_id, created=True, payload_hash=payload_hash)
