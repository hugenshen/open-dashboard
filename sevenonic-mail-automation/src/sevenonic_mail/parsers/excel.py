from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import PurePosixPath
from typing import Any

from openpyxl import load_workbook

from sevenonic_mail.domain import ExtractedDocument


class WorkbookSafetyError(ValueError):
    """Raised before workbook parsing when the OOXML container is unsafe."""


SHEET_PATTERNS: list[tuple[str, tuple[str, ...]]] = [
    ("MEASUREMENT", ("measurement", "specs measurements")),
    ("GRADED_SPECS", ("graded specs", "grading")),
    ("PP_COMMENTS", ("pp comments", "pp comment")),
    ("PHOTO_SAMPLE_APPROVAL", ("photo sample approval", "photo sample")),
    ("FULL_SIZE_MEASURE", ("full size measure", "bulk measure")),
    ("DESIGN_CONSTRUCTION", ("design + construction", "design", "construction")),
    ("FABRIC", ("fabric",)),
]

STYLE_RE = re.compile(r"\b([A-Z]{2,}\d{2,}[A-Z0-9]*)\b", re.IGNORECASE)
REVISION_RE = re.compile(r"\b(?:rev(?:ision)?|r)[-_ ]?(\d+)\b", re.IGNORECASE)


@dataclass(slots=True)
class WorkbookLimits:
    max_file_bytes: int = 50 * 1024 * 1024
    max_uncompressed_bytes: int = 200 * 1024 * 1024
    max_zip_ratio: int = 200
    max_cells: int = 500_000


def _normalize(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _json_value(value: object) -> object:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _semantic_for_sheet(name: str) -> str:
    normalized = re.sub(r"^\s*\d+\s*[.)_-]?\s*", "", name.lower()).strip()
    normalized = re.sub(r"\s*\(\d+\)\s*$", "", normalized)
    for semantic, patterns in SHEET_PATTERNS:
        if any(pattern in normalized for pattern in patterns):
            return semantic
    return "UNKNOWN"


class ExcelTechPackParser:
    name = "excel-tech-pack"
    version = "1.0.0"

    def __init__(self, limits: WorkbookLimits | None = None) -> None:
        self.limits = limits or WorkbookLimits()

    def _inspect_zip(self, content: bytes) -> dict[str, Any]:
        if len(content) > self.limits.max_file_bytes:
            raise WorkbookSafetyError("workbook exceeds maximum compressed size")
        if not zipfile.is_zipfile(io.BytesIO(content)):
            raise WorkbookSafetyError("attachment is not a valid OOXML zip container")

        total_uncompressed = 0
        has_vba = False
        has_external_links = False
        entry_count = 0
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            for info in archive.infolist():
                entry_count += 1
                path = PurePosixPath(info.filename)
                if path.is_absolute() or ".." in path.parts:
                    raise WorkbookSafetyError(f"unsafe OOXML path: {info.filename}")
                total_uncompressed += info.file_size
                if total_uncompressed > self.limits.max_uncompressed_bytes:
                    raise WorkbookSafetyError("workbook exceeds maximum uncompressed size")
                if info.file_size and info.compress_size == 0:
                    raise WorkbookSafetyError("suspicious zero-size compressed OOXML entry")
                if info.compress_size:
                    ratio = info.file_size / info.compress_size
                    if ratio > self.limits.max_zip_ratio:
                        raise WorkbookSafetyError("suspicious OOXML compression ratio")
                lowered = info.filename.lower()
                has_vba = has_vba or lowered.endswith("vbaproject.bin")
                has_external_links = has_external_links or "/externallinks/" in lowered
        return {
            "entry_count": entry_count,
            "uncompressed_bytes": total_uncompressed,
            "has_vba": has_vba,
            "has_external_links": has_external_links,
        }

    @staticmethod
    def _find_style(filename: str, workbook: Any) -> str | None:
        match = STYLE_RE.search(filename)
        if match:
            return match.group(1).upper()
        for sheet in workbook.worksheets:
            for row in sheet.iter_rows(min_row=1, max_row=min(sheet.max_row, 20)):
                for cell in row:
                    if isinstance(cell.value, str):
                        match = STYLE_RE.search(cell.value)
                        if match:
                            candidate = match.group(1).upper()
                            if candidate not in {"HELLOMOLLY", "MEASUREMENT"}:
                                return candidate
        return None

    @staticmethod
    def _find_revision(filename: str) -> int:
        match = REVISION_RE.search(filename)
        return int(match.group(1)) if match else 1

    @staticmethod
    def _header_text(sheet: Any, row: int, column: int) -> str:
        parts = []
        for offset in range(3):
            raw_value = sheet.cell(row=row + offset, column=column).value
            value = _normalize(raw_value) if isinstance(raw_value, str) else ""
            if value and value.upper() not in {part.upper() for part in parts}:
                parts.append(value)
        return " / ".join(parts)

    def _extract_measurement_rows(self, sheet: Any) -> list[dict[str, Any]]:
        header_row: int | None = None
        measurement_column: int | None = None
        ref_column: int | None = None
        scan_rows = min(sheet.max_row, 45)
        scan_columns = min(sheet.max_column, 80)
        for row in range(1, scan_rows + 1):
            for column in range(1, scan_columns + 1):
                text = _normalize(sheet.cell(row=row, column=column).value).upper()
                if "MEASUREMENT POINT" in text:
                    header_row = row
                    measurement_column = column
                if text in {"REF #", "REF#", "REF"}:
                    ref_column = column
            if header_row:
                break

        if header_row is None or measurement_column is None:
            return []
        if ref_column is None:
            ref_column = max(1, measurement_column - 1)

        headers = {
            column: self._header_text(sheet, header_row, column)
            for column in range(measurement_column + 1, scan_columns + 1)
        }
        result: list[dict[str, Any]] = []
        blank_run = 0
        for row in range(header_row + 1, min(sheet.max_row, 1000) + 1):
            point = _normalize(sheet.cell(row=row, column=measurement_column).value)
            ref = _normalize(sheet.cell(row=row, column=ref_column).value)
            numeric_values: list[dict[str, Any]] = []
            for column, header in headers.items():
                value = sheet.cell(row=row, column=column).value
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    numeric_values.append(
                        {
                            "header": header or f"COLUMN_{column}",
                            "value": value,
                            "cell": sheet.cell(row=row, column=column).coordinate,
                        }
                    )
            if not point and not ref and not numeric_values:
                blank_run += 1
                if blank_run >= 15 and result:
                    break
                continue
            blank_run = 0
            if not point or point.upper() in {"DATES", "MEASUREMENT POINT"}:
                continue
            result.append(
                {
                    "ref": ref or None,
                    "measurement_point": point,
                    "row": row,
                    "values": numeric_values,
                    "evidence": {
                        "sheet": sheet.title,
                        "measurement_cell": sheet.cell(
                            row=row, column=measurement_column
                        ).coordinate,
                    },
                }
            )
        return result

    @staticmethod
    def _non_empty_cells(sheet: Any, limit: int = 300) -> list[dict[str, Any]]:
        cells: list[dict[str, Any]] = []
        for row in sheet.iter_rows():
            for cell in row:
                if cell.value is not None:
                    cells.append({"cell": cell.coordinate, "value": _json_value(cell.value)})
                    if len(cells) >= limit:
                        return cells
        return cells

    def parse(self, filename: str, content: bytes) -> ExtractedDocument:
        zip_manifest = self._inspect_zip(content)
        workbook = load_workbook(
            io.BytesIO(content),
            read_only=False,
            data_only=False,
            keep_vba=False,
            keep_links=False,
        )
        try:
            estimated_cells = sum(sheet.max_row * sheet.max_column for sheet in workbook.worksheets)
            if estimated_cells > self.limits.max_cells:
                raise WorkbookSafetyError("workbook logical cell range exceeds safety limit")

            sheets: list[dict[str, Any]] = []
            measurements: list[dict[str, Any]] = []
            comments: list[dict[str, Any]] = []
            formula_count = 0
            for sheet in workbook.worksheets:
                semantic = _semantic_for_sheet(sheet.title)
                formula_count += sum(
                    1
                    for row in sheet.iter_rows()
                    for cell in row
                    if isinstance(cell.value, str) and cell.value.startswith("=")
                )
                sheets.append(
                    {
                        "name": sheet.title,
                        "semantic": semantic,
                        "state": sheet.sheet_state,
                        "max_row": sheet.max_row,
                        "max_column": sheet.max_column,
                        "merged_ranges": [str(item) for item in sheet.merged_cells.ranges],
                    }
                )
                if semantic in {"MEASUREMENT", "GRADED_SPECS", "FULL_SIZE_MEASURE"}:
                    for item in self._extract_measurement_rows(sheet):
                        item["sheet_semantic"] = semantic
                        measurements.append(item)
                elif semantic in {"PP_COMMENTS", "PHOTO_SAMPLE_APPROVAL"}:
                    comments.append(
                        {
                            "sheet": sheet.title,
                            "semantic": semantic,
                            "cells": self._non_empty_cells(sheet),
                        }
                    )

            style_no = self._find_style(filename, workbook)
            revision = self._find_revision(filename)
            issues: list[dict[str, Any]] = []
            if zip_manifest["has_vba"]:
                issues.append({"code": "MACRO_PRESENT", "severity": "BLOCK"})
            if zip_manifest["has_external_links"]:
                issues.append({"code": "EXTERNAL_LINK_PRESENT", "severity": "REVIEW"})
            if not style_no:
                issues.append({"code": "STYLE_NOT_FOUND", "severity": "REVIEW"})
            if not any(sheet["semantic"] != "UNKNOWN" for sheet in sheets):
                issues.append({"code": "UNKNOWN_TEMPLATE", "severity": "BLOCK"})

            payload = {
                "style_no": style_no,
                "revision": revision,
                "template_family": "GARMENT_TECH_PACK_V1",
                "sheets": sheets,
                "measurements": measurements,
                "comments": comments,
                "formula_count": formula_count,
                "workbook_manifest": zip_manifest,
            }
            evidence = {
                "source": filename,
                "style": {"source": "filename_or_header", "value": style_no},
                "revision": {"source": "filename", "value": revision},
                "measurement_count": len(measurements),
            }
            return ExtractedDocument(
                document_type="TECH_PACK",
                parser_name=self.name,
                parser_version=self.version,
                payload=payload,
                evidence=evidence,
                issues=issues,
            )
        finally:
            workbook.close()

    @staticmethod
    def diff(previous: ExtractedDocument, current: ExtractedDocument) -> dict[str, Any]:
        def flatten(document: ExtractedDocument) -> dict[str, object]:
            result: dict[str, object] = {}
            for row in document.payload.get("measurements", []):
                semantic = row.get("sheet_semantic", "UNKNOWN")
                point = row.get("ref") or row.get("measurement_point")
                for value in row.get("values", []):
                    key = f"{semantic}|{point}|{value.get('header')}"
                    result[key] = value.get("value")
            return result

        before = flatten(previous)
        after = flatten(current)
        changes: list[dict[str, Any]] = []
        for key in sorted(before.keys() | after.keys()):
            if key not in before:
                changes.append({"path": key, "change": "ADDED", "after": after[key]})
            elif key not in after:
                changes.append({"path": key, "change": "REMOVED", "before": before[key]})
            elif before[key] != after[key]:
                changes.append(
                    {
                        "path": key,
                        "change": "MODIFIED",
                        "before": before[key],
                        "after": after[key],
                    }
                )
        return {
            "from_revision": previous.payload.get("revision"),
            "to_revision": current.payload.get("revision"),
            "changes": changes,
        }
