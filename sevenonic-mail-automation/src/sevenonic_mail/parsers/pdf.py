from __future__ import annotations

import io
import re

from pypdf import PdfReader

from sevenonic_mail.domain import ExtractedDocument

PO_RE = re.compile(
    r"\bP(?:URCHASE\s+)?O(?:RDER)?\s*(?:NO\.?|#|NUMBER)?\s*[:#-]?\s*([A-Z0-9-]{4,})",
    re.I,
)
REV_RE = re.compile(r"\b(?:REV(?:ISION)?|R)\s*[:#-]?\s*(\d+)\b", re.I)
QTY_RE = re.compile(r"\b(?:TOTAL\s+QTY|QUANTITY|QTY)\s*[:#-]?\s*([0-9,]+(?:\.\d+)?)", re.I)


class PdfPurchaseOrderParser:
    name = "pdf-purchase-order"
    version = "1.0.0"

    def parse(self, filename: str, content: bytes) -> ExtractedDocument:
        reader = PdfReader(io.BytesIO(content), strict=False)
        pages = [page.extract_text() or "" for page in reader.pages]
        text = "\n".join(pages)
        po_match = PO_RE.search(text)
        rev_match = REV_RE.search(text)
        qty_match = QTY_RE.search(text)
        issues: list[dict[str, str]] = []
        if not po_match:
            issues.append({"code": "PO_NUMBER_NOT_FOUND", "severity": "REVIEW"})
        payload = {
            "po_no": po_match.group(1).upper() if po_match else None,
            "revision": int(rev_match.group(1)) if rev_match else 1,
            "quantity": float(qty_match.group(1).replace(",", "")) if qty_match else None,
            "page_count": len(pages),
        }
        evidence = {
            "source": filename,
            "pages": [
                {"page": index + 1, "text": value[:10_000]} for index, value in enumerate(pages)
            ],
        }
        return ExtractedDocument(
            document_type="PO",
            parser_name=self.name,
            parser_version=self.version,
            payload=payload,
            evidence=evidence,
            issues=issues,
        )
