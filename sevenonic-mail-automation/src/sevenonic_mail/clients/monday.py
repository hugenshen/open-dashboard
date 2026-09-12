from __future__ import annotations

import json
from typing import Any

import httpx


class MondayError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


class MondayClient:
    def __init__(
        self,
        api_token: str,
        *,
        api_version: str = "2026-07",
        http: httpx.AsyncClient | None = None,
        endpoint: str = "https://api.monday.com/v2",
    ) -> None:
        self.api_token = api_token
        self.api_version = api_version
        self.http = http or httpx.AsyncClient(timeout=30)
        self.endpoint = endpoint

    async def execute(
        self,
        query: str,
        variables: dict[str, Any] | None = None,
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": self.api_token,
            "API-Version": self.api_version,
            "Content-Type": "application/json",
        }
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        response = await self.http.post(
            self.endpoint,
            headers=headers,
            json={"query": query, "variables": variables or {}},
        )
        if response.status_code >= 400:
            raise MondayError(
                f"monday HTTP {response.status_code}",
                retryable=response.status_code in {408, 409, 429} or response.status_code >= 500,
            )
        payload = response.json()
        if payload.get("errors"):
            messages = "; ".join(str(item.get("message", item)) for item in payload["errors"])
            raise MondayError(f"monday GraphQL error: {messages}")
        if "data" not in payload:
            raise MondayError("monday response has no data field")
        return dict(payload["data"])

    async def board_schema(self, board_id: str) -> dict[str, Any]:
        query = """
        query BoardSchema($ids: [ID!]!) {
          boards(ids: $ids) {
            id name
            groups { id title }
            columns { id title type settings_str }
          }
        }
        """
        data = await self.execute(query, {"ids": [str(board_id)]})
        boards = data.get("boards", [])
        if len(boards) != 1:
            raise MondayError(f"expected one monday board, received {len(boards)}")
        return dict(boards[0])

    async def find_item_by_event_id(
        self, board_id: str, event_column_id: str, event_id: str
    ) -> str | None:
        query = """
        query FindItem($boardId: ID!, $columnId: String!, $values: [String!]!) {
          items_page_by_column_values(
            board_id: $boardId,
            columns: [{column_id: $columnId, column_values: $values}],
            limit: 2
          ) { items { id name } }
        }
        """
        data = await self.execute(
            query,
            {
                "boardId": str(board_id),
                "columnId": event_column_id,
                "values": [event_id],
            },
        )
        items = data.get("items_page_by_column_values", {}).get("items", [])
        if len(items) > 1:
            raise MondayError(f"duplicate remote event_id {event_id}")
        return str(items[0]["id"]) if items else None

    async def create_item(
        self,
        *,
        board_id: str,
        group_id: str,
        item_name: str,
        column_values: dict[str, Any],
        idempotency_key: str,
    ) -> str:
        mutation = """
        mutation CreateReviewItem(
          $boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!
        ) {
          create_item(
            board_id: $boardId,
            group_id: $groupId,
            item_name: $itemName,
            column_values: $columnValues
          ) { id }
        }
        """
        data = await self.execute(
            mutation,
            {
                "boardId": str(board_id),
                "groupId": group_id,
                "itemName": item_name,
                "columnValues": json.dumps(column_values, ensure_ascii=False),
            },
            idempotency_key=idempotency_key,
        )
        item = data.get("create_item")
        if not item or not item.get("id"):
            raise MondayError("monday create_item returned no item id")
        return str(item["id"])

    async def item(self, item_id: str) -> dict[str, Any] | None:
        query = """
        query Item($ids: [ID!]!) {
          items(ids: $ids) { id name updated_at column_values { id text value } }
        }
        """
        data = await self.execute(query, {"ids": [str(item_id)]})
        items = data.get("items", [])
        return dict(items[0]) if items else None
