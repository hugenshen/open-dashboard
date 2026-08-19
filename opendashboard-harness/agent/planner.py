"""Structured plan contracts used by Harness runs."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional


PlanKind = Literal["ask", "dashboard", "knowledge_change"]


@dataclass
class PlanStep:
    id: str
    title: str
    status: Literal["pending", "running", "completed", "failed"] = "pending"
    detail: str = ""


@dataclass
class StructuredPlan:
    kind: PlanKind
    title: str
    dataset_ids: List[str] = field(default_factory=list)
    steps: List[PlanStep] = field(default_factory=list)
    refs: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    confidence: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "title": self.title,
            "datasetIds": self.dataset_ids,
            "steps": [step.__dict__ for step in self.steps],
            "refs": self.refs,
            "confidence": self.confidence,
        }
