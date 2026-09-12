from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sevenonic_mail.domain import DeltaMessage, ExtractedDocument, IngestedEvent
from sevenonic_mail.parsers import ExcelTechPackParser, MimeParser, PdfPurchaseOrderParser
from sevenonic_mail.storage.artifacts import ArtifactStore
from sevenonic_mail.storage.database import Repository


def _canonical_json(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _customer_id(sender: str) -> str:
    domain = sender.rsplit("@", 1)[-1].lower() if "@" in sender else "unknown"
    return re.sub(r"[^a-z0-9.-]+", "_", domain) or "unknown"


class MailIngestionService:
    def __init__(
        self,
        repository: Repository,
        artifact_store: ArtifactStore,
        *,
        mime_parser: MimeParser | None = None,
        excel_parser: ExcelTechPackParser | None = None,
        pdf_parser: PdfPurchaseOrderParser | None = None,
        max_attachment_bytes: int = 50 * 1024 * 1024,
        enqueue_monday: bool = False,
    ) -> None:
        self.repository = repository
        self.artifact_store = artifact_store
        self.mime_parser = mime_parser or MimeParser()
        self.excel_parser = excel_parser or ExcelTechPackParser()
        self.pdf_parser = pdf_parser or PdfPurchaseOrderParser()
        self.max_attachment_bytes = max_attachment_bytes
        self.enqueue_monday = enqueue_monday

    @staticmethod
    def _document_parser(filename: str, content_type: str) -> str | None:
        suffix = Path(filename).suffix.lower()
        if suffix in {".xlsx", ".xlsm"} or "spreadsheetml" in content_type:
            return "excel"
        if suffix == ".pdf" or content_type == "application/pdf":
            return "pdf"
        return None

    @staticmethod
    def _business_identity(
        extracted: ExtractedDocument, customer_id: str, artifact_sha256: str
    ) -> tuple[str, str, int] | None:
        if extracted.document_type == "TECH_PACK":
            style = extracted.payload.get("style_no")
            if not style:
                return None
            revision = int(extracted.payload.get("revision") or 1)
            return "TECH_PACK", f"TECH_PACK|{customer_id}|{style}|R{revision}", revision
        if extracted.document_type == "PO":
            po_no = extracted.payload.get("po_no")
            if not po_no:
                return None
            revision = int(extracted.payload.get("revision") or 1)
            return "PO", f"PO|{customer_id}|{po_no}|R{revision}", revision
        return "DOCUMENT", f"DOCUMENT|{customer_id}|{artifact_sha256}", 1

    def ingest(
        self,
        *,
        mailbox_id: str,
        folder_id: str,
        delta_message: DeltaMessage,
        raw_mime: bytes,
    ) -> list[IngestedEvent]:
        parsed = self.mime_parser.parse(raw_mime)
        namespace = f"mail-{mailbox_id}-{delta_message.immutable_id}"
        mime_uri, mime_sha256 = self.artifact_store.put(namespace, "message.eml", raw_mime)
        mail_copy_id, created = self.repository.upsert_mail_copy(
            {
                "mailbox_id": mailbox_id,
                "folder_id": folder_id,
                "current_folder_id": folder_id,
                "immutable_id": delta_message.immutable_id,
                "internet_message_id": (
                    parsed.internet_message_id or delta_message.internet_message_id
                ),
                "subject": parsed.subject or delta_message.subject,
                "sender": parsed.sender,
                "received_at": delta_message.received_at,
                "mime_sha256": mime_sha256,
                "archive_uri": mime_uri,
                "graph_presence": "PRESENT",
                "archive_status": "FULLY_ARCHIVED",
                "security_status": "NOT_SCANNED",
            }
        )
        if not created:
            return []

        content_hash = _sha256_text(
            "\n".join(
                [
                    re.sub(r"\s+", " ", parsed.text_body).strip(),
                    *sorted(attachment.sha256 for attachment in parsed.attachments),
                ]
            )
        )
        self.repository.get_or_create_canonical(
            parsed.internet_message_id or delta_message.internet_message_id,
            content_hash,
            mail_copy_id,
        )

        customer_id = _customer_id(parsed.sender)
        result: list[IngestedEvent] = []
        for attachment in parsed.attachments:
            uri, digest = self.artifact_store.put(
                namespace, attachment.filename, attachment.content
            )
            artifact_id, artifact_created = self.repository.add_artifact(
                {
                    "mail_copy_id": mail_copy_id,
                    "filename": attachment.filename,
                    "content_type": attachment.content_type,
                    "size_bytes": len(attachment.content),
                    "sha256": digest,
                    "archive_uri": uri,
                    "is_inline": attachment.is_inline,
                    "parse_status": "PENDING",
                }
            )
            if not artifact_created:
                continue
            if len(attachment.content) > self.max_attachment_bytes:
                self.repository.set_artifact_parse_status(artifact_id, "TOO_LARGE")
                continue
            parser_kind = self._document_parser(attachment.filename, attachment.content_type)
            if not parser_kind or attachment.is_inline:
                self.repository.set_artifact_parse_status(artifact_id, "ARCHIVED_ONLY")
                continue
            try:
                extracted = (
                    self.excel_parser.parse(attachment.filename, attachment.content)
                    if parser_kind == "excel"
                    else self.pdf_parser.parse(attachment.filename, attachment.content)
                )
            except Exception as exc:
                self.repository.set_artifact_parse_status(
                    artifact_id, f"FAILED_{type(exc).__name__}"[:32]
                )
                continue

            if any(issue.get("severity") == "BLOCK" for issue in extracted.issues):
                self.repository.set_artifact_parse_status(artifact_id, "QUARANTINED")
                continue
            identity = self._business_identity(extracted, customer_id, digest)
            if not identity:
                self.repository.set_artifact_parse_status(artifact_id, "REVIEW_REQUIRED")
                continue
            event_type, business_key, revision = identity
            payload_hash = _sha256_text(_canonical_json(extracted.payload))
            event_id = f"evt_{_sha256_text(business_key)[:24]}"
            stored_event_id, event_created, conflict = self.repository.upsert_business_event(
                {
                    "event_id": event_id,
                    "event_type": event_type,
                    "customer_id": customer_id,
                    "business_key": business_key,
                    "revision": revision,
                    "payload_hash": payload_hash,
                    "payload": extracted.payload,
                    "status": "REVIEW_REQUIRED",
                    "created_at": datetime.now(UTC),
                }
            )
            if conflict:
                self.repository.mark_event_conflict(stored_event_id)
            self.repository.add_extraction_run(
                {
                    "event_id": stored_event_id,
                    "artifact_id": artifact_id,
                    "parser_name": extracted.parser_name,
                    "parser_version": extracted.parser_version,
                    "result": extracted.payload,
                    "evidence": extracted.evidence,
                    "issues": extracted.issues,
                    "created_at": datetime.now(UTC),
                }
            )
            self.repository.set_artifact_parse_status(artifact_id, "PARSED")
            if event_created:
                if self.enqueue_monday:
                    self.repository.enqueue_job(
                        "WRITE_MONDAY",
                        stored_event_id,
                        {"event_id": stored_event_id},
                    )
                result.append(
                    IngestedEvent(
                        event_id=stored_event_id,
                        event_type=event_type,
                        customer_id=customer_id,
                        business_key=business_key,
                        revision=revision,
                        payload=extracted.payload,
                        source_mail_copy_id=mail_copy_id,
                    )
                )
        return result
