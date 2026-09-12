from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class DeltaMessage:
    immutable_id: str
    internet_message_id: str | None
    subject: str
    received_at: datetime | None
    last_modified_at: datetime | None
    has_attachments: bool
    raw: dict[str, Any]
    removed_reason: str | None = None


@dataclass(slots=True)
class DeltaBatch:
    messages: list[DeltaMessage]
    delta_link: str


@dataclass(slots=True)
class ParsedAttachment:
    filename: str
    content_type: str
    content: bytes
    sha256: str
    is_inline: bool = False


@dataclass(slots=True)
class ParsedMail:
    subject: str
    sender: str
    to: list[str]
    cc: list[str]
    internet_message_id: str | None
    sent_at: datetime | None
    text_body: str
    html_body: str | None
    attachments: list[ParsedAttachment] = field(default_factory=list)


@dataclass(slots=True)
class ExtractedDocument:
    document_type: str
    parser_name: str
    parser_version: str
    payload: dict[str, Any]
    evidence: dict[str, Any]
    issues: list[dict[str, Any]] = field(default_factory=list)


@dataclass(slots=True)
class IngestedEvent:
    event_id: str
    event_type: str
    customer_id: str
    business_key: str
    revision: int
    payload: dict[str, Any]
    source_mail_copy_id: int


@dataclass(slots=True)
class MondayWriteResult:
    item_id: str
    created: bool
    payload_hash: str
