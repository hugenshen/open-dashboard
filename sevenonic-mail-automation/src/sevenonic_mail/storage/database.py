from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    delete,
    insert,
    select,
    update,
)
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

metadata = MetaData()

subscriptions = Table(
    "subscriptions",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("remote_id", String(255), unique=True),
    Column("mailbox_id", String(320), nullable=False),
    Column("folder_id", String(512), nullable=False),
    Column("resource", Text, nullable=False),
    Column("expires_at", DateTime(timezone=True)),
    Column("status", String(32), nullable=False, default="ACTIVE"),
    UniqueConstraint("mailbox_id", "folder_id", name="uq_subscription_scope"),
)

delta_cursors = Table(
    "delta_cursors",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("mailbox_id", String(320), nullable=False),
    Column("folder_id", String(512), nullable=False),
    Column("delta_link", Text, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("mailbox_id", "folder_id", name="uq_delta_scope"),
)

jobs = Table(
    "jobs",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("job_type", String(64), nullable=False),
    Column("dedupe_key", String(512), nullable=False),
    Column("active_key", String(640), unique=True),
    Column("payload", JSON, nullable=False),
    Column("status", String(32), nullable=False, default="READY"),
    Column("attempt", Integer, nullable=False, default=0),
    Column("max_attempts", Integer, nullable=False, default=8),
    Column("run_after", DateTime(timezone=True), nullable=False),
    Column("last_error", Text),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

mail_copies = Table(
    "mail_copies",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("mailbox_id", String(320), nullable=False),
    Column("folder_id", String(512), nullable=False),
    Column("current_folder_id", String(512), nullable=False),
    Column("immutable_id", String(1024), nullable=False),
    Column("internet_message_id", Text),
    Column("subject", Text, nullable=False),
    Column("sender", String(512), nullable=False),
    Column("received_at", DateTime(timezone=True)),
    Column("mime_sha256", String(64), nullable=False),
    Column("archive_uri", Text, nullable=False),
    Column("graph_presence", String(32), nullable=False, default="PRESENT"),
    Column("archive_status", String(32), nullable=False, default="FULLY_ARCHIVED"),
    Column("security_status", String(32), nullable=False, default="NOT_SCANNED"),
    UniqueConstraint("mailbox_id", "immutable_id", name="uq_mail_copy"),
)

artifacts = Table(
    "artifacts",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("mail_copy_id", Integer, nullable=False),
    Column("filename", Text, nullable=False),
    Column("content_type", String(255), nullable=False),
    Column("size_bytes", BigInteger, nullable=False),
    Column("sha256", String(64), nullable=False),
    Column("archive_uri", Text, nullable=False),
    Column("is_inline", Boolean, nullable=False, default=False),
    Column("parse_status", String(32), nullable=False, default="PENDING"),
    UniqueConstraint("mail_copy_id", "sha256", "filename", name="uq_artifact"),
)

canonical_messages = Table(
    "canonical_messages",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("internet_message_id", Text),
    Column("content_hash", String(64), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("internet_message_id", "content_hash", name="uq_canonical_message"),
)

canonical_message_copies = Table(
    "canonical_message_copies",
    metadata,
    Column("canonical_message_id", Integer, nullable=False),
    Column("mail_copy_id", Integer, nullable=False, unique=True),
)

business_events = Table(
    "business_events",
    metadata,
    Column("event_id", String(64), primary_key=True),
    Column("event_type", String(64), nullable=False),
    Column("customer_id", String(320), nullable=False),
    Column("business_key", String(1024), nullable=False, unique=True),
    Column("revision", Integer, nullable=False),
    Column("payload_hash", String(64), nullable=False),
    Column("payload", JSON, nullable=False),
    Column("status", String(32), nullable=False, default="REVIEW_REQUIRED"),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

extraction_runs = Table(
    "extraction_runs",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("event_id", String(64), nullable=False),
    Column("artifact_id", Integer, nullable=False),
    Column("parser_name", String(128), nullable=False),
    Column("parser_version", String(64), nullable=False),
    Column("result", JSON, nullable=False),
    Column("evidence", JSON, nullable=False),
    Column("issues", JSON, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint(
        "event_id", "artifact_id", "parser_name", "parser_version", name="uq_extraction_run"
    ),
)

write_operations = Table(
    "write_operations",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("target", String(255), nullable=False),
    Column("event_id", String(64), nullable=False),
    Column("action", String(64), nullable=False),
    Column("payload_hash", String(64), nullable=False),
    Column("idempotency_key", String(255), nullable=False),
    Column("status", String(32), nullable=False),
    Column("remote_item_id", String(255)),
    Column("last_error", Text),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("target", "event_id", "action", "payload_hash", name="uq_write_operation"),
)


class Repository:
    def __init__(self, database_url: str) -> None:
        connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
        if database_url.startswith("sqlite:///"):
            database_path = database_url.removeprefix("sqlite:///")
            if database_path != ":memory:":
                Path(database_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        self.engine: Engine = create_engine(database_url, future=True, connect_args=connect_args)

    def create_schema(self) -> None:
        metadata.create_all(self.engine)

    def clear_all(self) -> None:
        with self.engine.begin() as connection:
            for table in reversed(metadata.sorted_tables):
                connection.execute(delete(table))

    def upsert_subscription(
        self,
        *,
        mailbox_id: str,
        folder_id: str,
        resource: str,
        remote_id: str,
        expires_at: datetime | None,
    ) -> None:
        values = {
            "mailbox_id": mailbox_id,
            "folder_id": folder_id,
            "resource": resource,
            "remote_id": remote_id,
            "expires_at": expires_at,
            "status": "ACTIVE",
        }
        with self.engine.begin() as connection:
            row = connection.execute(
                select(subscriptions.c.id).where(
                    subscriptions.c.mailbox_id == mailbox_id,
                    subscriptions.c.folder_id == folder_id,
                )
            ).first()
            if row:
                connection.execute(
                    update(subscriptions).where(subscriptions.c.id == row.id).values(**values)
                )
            else:
                connection.execute(insert(subscriptions).values(**values))

    def get_subscription_by_remote_id(self, remote_id: str) -> dict[str, Any] | None:
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    select(subscriptions).where(subscriptions.c.remote_id == remote_id)
                )
                .mappings()
                .first()
            )
            return dict(row) if row else None

    def get_subscription(self, mailbox_id: str, folder_id: str) -> dict[str, Any] | None:
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    select(subscriptions).where(
                        subscriptions.c.mailbox_id == mailbox_id,
                        subscriptions.c.folder_id == folder_id,
                    )
                )
                .mappings()
                .first()
            )
            return dict(row) if row else None

    def subscriptions_expiring_before(self, cutoff: datetime) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    select(subscriptions).where(
                        subscriptions.c.status == "ACTIVE",
                        subscriptions.c.expires_at.is_not(None),
                        subscriptions.c.expires_at <= cutoff,
                    )
                )
                .mappings()
                .all()
            )
            return [dict(row) for row in rows]

    def get_cursor(self, mailbox_id: str, folder_id: str) -> str | None:
        with self.engine.connect() as connection:
            return connection.execute(
                select(delta_cursors.c.delta_link).where(
                    delta_cursors.c.mailbox_id == mailbox_id,
                    delta_cursors.c.folder_id == folder_id,
                )
            ).scalar_one_or_none()

    def set_cursor(self, mailbox_id: str, folder_id: str, delta_link: str) -> None:
        now = datetime.now(UTC)
        with self.engine.begin() as connection:
            row = connection.execute(
                select(delta_cursors.c.id).where(
                    delta_cursors.c.mailbox_id == mailbox_id,
                    delta_cursors.c.folder_id == folder_id,
                )
            ).first()
            if row:
                connection.execute(
                    update(delta_cursors)
                    .where(delta_cursors.c.id == row.id)
                    .values(delta_link=delta_link, updated_at=now)
                )
            else:
                connection.execute(
                    insert(delta_cursors).values(
                        mailbox_id=mailbox_id,
                        folder_id=folder_id,
                        delta_link=delta_link,
                        updated_at=now,
                    )
                )

    def enqueue_job(self, job_type: str, dedupe_key: str, payload: dict[str, Any]) -> bool:
        now = datetime.now(UTC)
        try:
            with self.engine.begin() as connection:
                existing = connection.execute(
                    select(jobs.c.id).where(jobs.c.active_key == f"{job_type}|{dedupe_key}")
                ).first()
                if existing:
                    return False
                connection.execute(
                    insert(jobs).values(
                        job_type=job_type,
                        dedupe_key=dedupe_key,
                        active_key=f"{job_type}|{dedupe_key}",
                        payload=payload,
                        status="READY",
                        attempt=0,
                        max_attempts=8,
                        run_after=now,
                        created_at=now,
                        updated_at=now,
                    )
                )
                return True
        except IntegrityError:
            return False

    def claim_ready_jobs(self, limit: int = 10) -> list[dict[str, Any]]:
        now = datetime.now(UTC)
        claimed: list[dict[str, Any]] = []
        with self.engine.begin() as connection:
            rows = (
                connection.execute(
                    select(jobs)
                    .where(jobs.c.status == "READY", jobs.c.run_after <= now)
                    .order_by(jobs.c.id)
                    .limit(limit)
                )
                .mappings()
                .all()
            )
            for row in rows:
                result = connection.execute(
                    update(jobs)
                    .where(jobs.c.id == row["id"], jobs.c.status == "READY")
                    .values(status="RUNNING", attempt=jobs.c.attempt + 1, updated_at=now)
                )
                if result.rowcount:
                    claimed.append(dict(row))
        return claimed

    def finish_job(self, job_id: int) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                update(jobs)
                .where(jobs.c.id == job_id)
                .values(status="SUCCEEDED", active_key=None, updated_at=datetime.now(UTC))
            )

    def fail_job(self, job_id: int, error: str) -> None:
        with self.engine.begin() as connection:
            row = connection.execute(
                select(jobs.c.attempt, jobs.c.max_attempts).where(jobs.c.id == job_id)
            ).first()
            if not row:
                return
            retrying = int(row.attempt) < int(row.max_attempts)
            backoff_seconds = min(300, 2 ** max(1, int(row.attempt)))
            values: dict[str, Any] = {
                "status": "READY" if retrying else "FAILED",
                "last_error": error[:4000],
                "run_after": datetime.now(UTC) + timedelta(seconds=backoff_seconds),
                "updated_at": datetime.now(UTC),
            }
            if not retrying:
                values["active_key"] = None
            connection.execute(update(jobs).where(jobs.c.id == job_id).values(**values))

    def get_mail_copy(self, mailbox_id: str, immutable_id: str) -> dict[str, Any] | None:
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    select(mail_copies).where(
                        mail_copies.c.mailbox_id == mailbox_id,
                        mail_copies.c.immutable_id == immutable_id,
                    )
                )
                .mappings()
                .first()
            )
            return dict(row) if row else None

    def upsert_mail_copy(self, values: dict[str, Any]) -> tuple[int, bool]:
        with self.engine.begin() as connection:
            row = connection.execute(
                select(mail_copies.c.id).where(
                    mail_copies.c.mailbox_id == values["mailbox_id"],
                    mail_copies.c.immutable_id == values["immutable_id"],
                )
            ).first()
            if row:
                connection.execute(
                    update(mail_copies)
                    .where(mail_copies.c.id == row.id)
                    .values(
                        current_folder_id=values["current_folder_id"],
                        graph_presence="PRESENT",
                    )
                )
                return int(row.id), False
            result = connection.execute(insert(mail_copies).values(**values))
            return int(result.inserted_primary_key[0]), True

    def mark_mail_removed(self, mailbox_id: str, immutable_id: str, folder_id: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                update(mail_copies)
                .where(
                    mail_copies.c.mailbox_id == mailbox_id,
                    mail_copies.c.immutable_id == immutable_id,
                )
                .values(
                    current_folder_id=folder_id,
                    graph_presence="REMOVED_FROM_FOLDER",
                )
            )

    def mark_mail_present(self, mailbox_id: str, immutable_id: str, folder_id: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                update(mail_copies)
                .where(
                    mail_copies.c.mailbox_id == mailbox_id,
                    mail_copies.c.immutable_id == immutable_id,
                )
                .values(
                    current_folder_id=folder_id,
                    graph_presence="PRESENT",
                )
            )

    def add_artifact(self, values: dict[str, Any]) -> tuple[int, bool]:
        try:
            with self.engine.begin() as connection:
                result = connection.execute(insert(artifacts).values(**values))
                return int(result.inserted_primary_key[0]), True
        except IntegrityError:
            with self.engine.connect() as connection:
                artifact_id = connection.execute(
                    select(artifacts.c.id).where(
                        artifacts.c.mail_copy_id == values["mail_copy_id"],
                        artifacts.c.sha256 == values["sha256"],
                        artifacts.c.filename == values["filename"],
                    )
                ).scalar_one()
                return int(artifact_id), False

    def set_artifact_parse_status(self, artifact_id: int, status: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                update(artifacts).where(artifacts.c.id == artifact_id).values(parse_status=status)
            )

    def get_or_create_canonical(
        self, internet_message_id: str | None, content_hash: str, mail_copy_id: int
    ) -> int:
        with self.engine.begin() as connection:
            condition = canonical_messages.c.content_hash == content_hash
            if internet_message_id:
                condition = condition & (
                    canonical_messages.c.internet_message_id == internet_message_id
                )
            row = connection.execute(select(canonical_messages.c.id).where(condition)).first()
            if row:
                canonical_id = int(row.id)
            else:
                result = connection.execute(
                    insert(canonical_messages).values(
                        internet_message_id=internet_message_id,
                        content_hash=content_hash,
                        created_at=datetime.now(UTC),
                    )
                )
                canonical_id = int(result.inserted_primary_key[0])
            linked = connection.execute(
                select(canonical_message_copies.c.mail_copy_id).where(
                    canonical_message_copies.c.mail_copy_id == mail_copy_id
                )
            ).first()
            if not linked:
                connection.execute(
                    insert(canonical_message_copies).values(
                        canonical_message_id=canonical_id, mail_copy_id=mail_copy_id
                    )
                )
            return canonical_id

    def upsert_business_event(self, values: dict[str, Any]) -> tuple[str, bool, bool]:
        """Return event_id, created, conflict (same key with different payload)."""
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    select(business_events).where(
                        business_events.c.business_key == values["business_key"]
                    )
                )
                .mappings()
                .first()
            )
            if row:
                return str(row["event_id"]), False, row["payload_hash"] != values["payload_hash"]
            connection.execute(insert(business_events).values(**values))
            return str(values["event_id"]), True, False

    def add_extraction_run(self, values: dict[str, Any]) -> None:
        try:
            with self.engine.begin() as connection:
                connection.execute(insert(extraction_runs).values(**values))
        except IntegrityError:
            return

    def get_event(self, event_id: str) -> dict[str, Any] | None:
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    select(business_events).where(business_events.c.event_id == event_id)
                )
                .mappings()
                .first()
            )
            return dict(row) if row else None

    def mark_event_conflict(self, event_id: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                update(business_events)
                .where(business_events.c.event_id == event_id)
                .values(status="BUSINESS_CONFLICT")
            )

    def get_write_operation(
        self, target: str, event_id: str, action: str, payload_hash: str
    ) -> dict[str, Any] | None:
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    select(write_operations).where(
                        write_operations.c.target == target,
                        write_operations.c.event_id == event_id,
                        write_operations.c.action == action,
                        write_operations.c.payload_hash == payload_hash,
                    )
                )
                .mappings()
                .first()
            )
            return dict(row) if row else None

    def begin_write_operation(
        self,
        *,
        target: str,
        event_id: str,
        action: str,
        payload_hash: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        existing = self.get_write_operation(target, event_id, action, payload_hash)
        if existing:
            return existing
        now = datetime.now(UTC)
        try:
            with self.engine.begin() as connection:
                result = connection.execute(
                    insert(write_operations).values(
                        target=target,
                        event_id=event_id,
                        action=action,
                        payload_hash=payload_hash,
                        idempotency_key=idempotency_key,
                        status="PENDING",
                        created_at=now,
                        updated_at=now,
                    )
                )
                operation_id = int(result.inserted_primary_key[0])
        except IntegrityError:
            found = self.get_write_operation(target, event_id, action, payload_hash)
            if found is None:
                raise
            return found
        return {
            "id": operation_id,
            "target": target,
            "event_id": event_id,
            "action": action,
            "payload_hash": payload_hash,
            "idempotency_key": idempotency_key,
            "status": "PENDING",
            "remote_item_id": None,
        }

    def update_write_operation(
        self,
        operation_id: int,
        status: str,
        *,
        remote_item_id: str | None = None,
        error: str | None = None,
    ) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                update(write_operations)
                .where(write_operations.c.id == operation_id)
                .values(
                    status=status,
                    remote_item_id=remote_item_id,
                    last_error=error[:4000] if error else None,
                    updated_at=datetime.now(UTC),
                )
            )

    def counts(self) -> dict[str, int]:
        result: dict[str, int] = {}
        with self.engine.connect() as connection:
            counted_tables = [
                jobs,
                mail_copies,
                artifacts,
                canonical_messages,
                business_events,
                extraction_runs,
                write_operations,
            ]
            for table in counted_tables:
                result[table.name] = len(connection.execute(select(table.c[0])).all())
        return result

    @staticmethod
    def canonical_json(data: dict[str, Any]) -> str:
        return json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
