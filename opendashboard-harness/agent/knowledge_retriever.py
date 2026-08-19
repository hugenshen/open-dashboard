"""Harness-side knowledge retrieval facade.

The current implementation reads local dataset knowledge. P009's target state
will replace the loader with Java-provided active knowledgeRefs plus indexed
keyword/vector retrieval.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from agent.knowledge import load, match_examples, match_glossary, prompt_block


def retrieve_dataset_knowledge(
    question: str,
    dataset_id: Optional[str],
    *,
    workspace_id: str = "default",
) -> Dict[str, Any]:
    if not dataset_id:
        return {"knowledgeRefs": [], "promptBlock": ""}
    doc = load(dataset_id, workspace_id=workspace_id)
    terms = match_glossary(question, doc.get("glossary") or [])
    examples = match_examples(question, doc.get("examples") or [])
    refs: List[Dict[str, Any]] = []
    refs.extend({"type": "glossary", "workspaceId": workspace_id, "datasetId": dataset_id, **term} for term in terms)
    refs.extend(
        {"type": "sql_example", "workspaceId": workspace_id, "datasetId": dataset_id, "question": ex["question"]}
        for ex in examples
    )
    return {"knowledgeRefs": refs, "promptBlock": prompt_block(question, dataset_id, workspace_id=workspace_id)}
