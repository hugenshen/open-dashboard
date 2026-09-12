from __future__ import annotations

import hashlib
import re
from email import policy
from email.message import Message
from email.parser import BytesParser
from html.parser import HTMLParser

from sevenonic_mail.domain import ParsedAttachment, ParsedMail


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        value = data.strip()
        if value:
            self.parts.append(value)

    def text(self) -> str:
        return re.sub(r"\s+", " ", " ".join(self.parts)).strip()


def _addresses(message: Message, header: str) -> list[str]:
    result: list[str] = []
    for value in message.get_all(header, []):
        if hasattr(value, "addresses"):
            result.extend(str(address.addr_spec).lower() for address in value.addresses)
        else:
            result.append(str(value))
    return result


class MimeParser:
    def parse(self, raw_mime: bytes) -> ParsedMail:
        message = BytesParser(policy=policy.default).parsebytes(raw_mime)
        text_parts: list[str] = []
        html_parts: list[str] = []
        attachments: list[ParsedAttachment] = []

        for part in message.walk():
            if part.is_multipart():
                continue
            disposition = part.get_content_disposition()
            filename = part.get_filename()
            content_type = part.get_content_type()
            payload = part.get_payload(decode=True) or b""

            if filename or disposition in {"attachment", "inline"}:
                attachments.append(
                    ParsedAttachment(
                        filename=filename or f"inline-{len(attachments) + 1}",
                        content_type=content_type,
                        content=payload,
                        sha256=hashlib.sha256(payload).hexdigest(),
                        is_inline=disposition == "inline",
                    )
                )
            elif content_type == "text/plain":
                text_parts.append(str(part.get_content()))
            elif content_type == "text/html":
                html_parts.append(str(part.get_content()))

        html_body = "\n".join(html_parts).strip() or None
        text_body = "\n".join(text_parts).strip()
        if not text_body and html_body:
            extractor = _TextExtractor()
            extractor.feed(html_body)
            text_body = extractor.text()

        senders = _addresses(message, "from")
        date_header = message.get("date")
        return ParsedMail(
            subject=str(message.get("subject", "")),
            sender=senders[0] if senders else "",
            to=_addresses(message, "to"),
            cc=_addresses(message, "cc"),
            internet_message_id=(
                str(message.get("message-id")) if message.get("message-id") else None
            ),
            sent_at=getattr(date_header, "datetime", None),
            text_body=text_body,
            html_body=html_body,
            attachments=attachments,
        )
