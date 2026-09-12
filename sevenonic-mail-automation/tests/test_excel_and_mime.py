from __future__ import annotations

import pytest
from conftest import build_mime, build_tech_pack

from sevenonic_mail.parsers import ExcelTechPackParser, MimeParser, WorkbookSafetyError


def test_mime_parser_extracts_body_recipients_and_excel() -> None:
    parsed = MimeParser().parse(build_mime(build_tech_pack()))

    assert parsed.sender == "buyer@customer-a.com"
    assert parsed.to == ["po@sevenonic.com"]
    assert sorted(parsed.cc) == ["boss@sevenonic.com", "merch.a@sevenonic.com"]
    assert "Please review attached" in parsed.text_body
    assert parsed.internet_message_id == "<hmv071-r4@customer-a.com>"
    assert len(parsed.attachments) == 1
    assert parsed.attachments[0].filename == "HMV071-Tech-Pack-Rev4.xlsx"


def test_excel_parser_understands_garment_sheets_and_evidence() -> None:
    result = ExcelTechPackParser().parse("HMV071-Tech-Pack-Rev4.xlsx", build_tech_pack())

    assert result.document_type == "TECH_PACK"
    assert result.payload["style_no"] == "HMV071"
    assert result.payload["revision"] == 4
    semantics = {sheet["semantic"] for sheet in result.payload["sheets"]}
    assert {
        "MEASUREMENT",
        "GRADED_SPECS",
        "PP_COMMENTS",
        "PHOTO_SAMPLE_APPROVAL",
        "FULL_SIZE_MEASURE",
    }.issubset(semantics)
    bust = next(row for row in result.payload["measurements"] if row["ref"] == "2")
    assert bust["evidence"]["sheet"] in {"3. MEASUREMENT", "4. Graded Specs (2)"}
    assert any(value["value"] == 36.0 for value in bust["values"])
    assert result.evidence["measurement_count"] >= 4


def test_excel_revision_diff_reports_changed_measurement() -> None:
    parser = ExcelTechPackParser()
    previous = parser.parse("HMV071-Tech-Pack-Rev3.xlsx", build_tech_pack(bust_value=35.0))
    current = parser.parse("HMV071-Tech-Pack-Rev4.xlsx", build_tech_pack(bust_value=36.0))

    diff = parser.diff(previous, current)

    assert diff["from_revision"] == 3
    assert diff["to_revision"] == 4
    assert any(
        item["change"] == "MODIFIED" and item["before"] == 35.0 and item["after"] == 36.0
        for item in diff["changes"]
    )


def test_invalid_ooxml_is_rejected_before_parser() -> None:
    with pytest.raises(WorkbookSafetyError):
        ExcelTechPackParser().parse("fake.xlsx", b"not a zip")
