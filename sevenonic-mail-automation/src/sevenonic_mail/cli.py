from __future__ import annotations

import argparse
import asyncio
import json
import time

import uvicorn

from sevenonic_mail.app import build_container
from sevenonic_mail.config import get_settings


async def _run_worker() -> None:
    settings = get_settings()
    container = build_container(settings)
    next_sweep = 0.0
    next_renewal = 0.0
    while True:
        now = time.monotonic()
        if now >= next_sweep:
            for mailbox in settings.graph_mailboxes_json:
                container.repository.enqueue_job(
                    "SYNC_MAILBOX",
                    f"{mailbox.mailbox_id}|{mailbox.folder_id}",
                    {"mailbox_id": mailbox.mailbox_id, "folder_id": mailbox.folder_id},
                )
            next_sweep = now + settings.sync_interval_seconds
        if now >= next_renewal and container.subscription_service:
            result = await container.subscription_service.renew_due(
                settings.subscription_renew_before_seconds
            )
            print({"subscription_renewal": result})
            next_renewal = now + min(settings.subscription_renew_before_seconds / 2, 3600)
        result = await container.job_runner.run_once(20)
        if result["claimed"]:
            print({"jobs": result})
        await asyncio.sleep(settings.worker_idle_seconds)


async def _run(command: str, mailbox: str | None, folder: str) -> None:
    if command == "run-worker":
        await _run_worker()
        return
    settings = get_settings()
    container = build_container(settings)
    if command == "init-db":
        print("database schema initialized")
        return
    if command == "check-connections":
        if not container.graph:
            raise SystemExit("Graph credentials are not configured")
        if not settings.graph_mailboxes_json:
            raise SystemExit("GRAPH_MAILBOXES_JSON is empty")
        graph_scopes = []
        for configured in settings.graph_mailboxes_json:
            folder_data = await container.graph.mail_folder(
                configured.mailbox_id, configured.folder_id
            )
            graph_scopes.append(
                {
                    "mailbox_id": configured.mailbox_id,
                    "requested_folder_id": configured.folder_id,
                    "resolved_folder_id": folder_data.get("id"),
                    "display_name": folder_data.get("displayName"),
                    "total_items": folder_data.get("totalItemCount"),
                }
            )
        monday_schema = None
        if container.monday and settings.monday_board_id:
            schema = await container.monday.board_schema(settings.monday_board_id)
            monday_schema = {
                "board_id": schema.get("id"),
                "name": schema.get("name"),
                "groups": [group.get("id") for group in schema.get("groups", [])],
                "columns": {
                    column.get("id"): column.get("type") for column in schema.get("columns", [])
                },
            }
        print(
            json.dumps(
                {"graph_scopes": graph_scopes, "monday_schema": monday_schema},
                ensure_ascii=False,
                indent=2,
            )
        )
        return
    if command == "bootstrap-subscriptions":
        if not container.subscription_service:
            raise SystemExit("Graph is not configured")
        for configured in settings.graph_mailboxes_json:
            result = await container.subscription_service.ensure(
                configured.mailbox_id, configured.folder_id
            )
            print(f"created subscription {result['id']} for {configured.mailbox_id}")
        return
    if command == "sync-once":
        if not mailbox:
            raise SystemExit("--mailbox is required")
        if not container.sync_service:
            raise SystemExit("Graph is not configured")
        print(await container.sync_service.sync(mailbox, folder))
        return
    if command == "run-jobs":
        print(await container.job_runner.run_once(100))
        return
    raise SystemExit(f"unsupported command {command}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sevenonic mail automation operations")
    parser.add_argument(
        "command",
        choices=[
            "serve",
            "init-db",
            "check-connections",
            "bootstrap-subscriptions",
            "sync-once",
            "run-jobs",
            "run-worker",
        ],
    )
    parser.add_argument("--mailbox")
    parser.add_argument("--folder", default="inbox")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8091)
    args = parser.parse_args()
    if args.command == "serve":
        uvicorn.run(
            "sevenonic_mail.app:create_app",
            host=args.host,
            port=args.port,
            factory=True,
        )
        return
    asyncio.run(_run(args.command, args.mailbox, args.folder))


if __name__ == "__main__":
    main()
