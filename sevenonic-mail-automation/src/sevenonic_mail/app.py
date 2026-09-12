from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import PlainTextResponse

from sevenonic_mail.clients.graph import GraphClient, OAuthClientCredentialsProvider
from sevenonic_mail.clients.monday import MondayClient
from sevenonic_mail.config import Settings, get_settings
from sevenonic_mail.services import (
    JobRunner,
    MailIngestionService,
    MailSyncService,
    MondayWriter,
    SubscriptionService,
)
from sevenonic_mail.storage.artifacts import ArtifactStore
from sevenonic_mail.storage.database import Repository


@dataclass(slots=True)
class Container:
    settings: Settings
    repository: Repository
    ingestion: MailIngestionService
    graph: GraphClient | None
    monday: MondayClient | None
    subscription_service: SubscriptionService | None
    sync_service: MailSyncService | None
    monday_writer: MondayWriter | None
    job_runner: JobRunner


def build_container(
    settings: Settings,
    *,
    graph: GraphClient | None = None,
    monday: MondayClient | None = None,
) -> Container:
    repository = Repository(settings.database_url)
    repository.create_schema()
    artifact_store = ArtifactStore(settings.artifact_root)

    if graph is None and settings.graph_configured:
        token_provider = OAuthClientCredentialsProvider(
            settings.graph_tenant_id,
            settings.graph_client_id,
            settings.graph_client_secret,
        )
        graph = GraphClient(token_provider)
    if monday is None and settings.monday_configured:
        monday = MondayClient(
            settings.monday_api_token,
            api_version=settings.monday_api_version,
        )

    monday_writer = None
    if monday and settings.monday_board_id and settings.monday_group_id:
        monday_writer = MondayWriter(
            repository,
            monday,
            board_id=settings.monday_board_id,
            group_id=settings.monday_group_id,
            event_column_id=settings.monday_event_column_id,
            style_column_id=settings.monday_style_column_id,
            revision_column_id=settings.monday_revision_column_id,
            review_status_column_id=settings.monday_review_status_column_id,
            review_status_label=settings.monday_review_status_label,
        )
    ingestion = MailIngestionService(
        repository,
        artifact_store,
        max_attachment_bytes=settings.max_attachment_bytes,
        enqueue_monday=monday_writer is not None,
    )
    sync_service = MailSyncService(repository, graph, ingestion) if graph else None
    subscription_service = None
    if graph:
        subscription_service = SubscriptionService(
            repository,
            graph,
            notification_url=settings.graph_notification_url,
            lifecycle_url=settings.graph_lifecycle_url or settings.graph_notification_url,
            client_state=settings.graph_client_state,
        )
    runner = JobRunner(
        repository,
        sync_service=sync_service,
        monday_writer=monday_writer,
        subscription_service=subscription_service,
    )
    return Container(
        settings=settings,
        repository=repository,
        ingestion=ingestion,
        graph=graph,
        monday=monday,
        subscription_service=subscription_service,
        sync_service=sync_service,
        monday_writer=monday_writer,
        job_runner=runner,
    )


def create_app(
    *,
    settings: Settings | None = None,
    container: Container | None = None,
) -> FastAPI:
    active_settings = settings or get_settings()
    active_container = container or build_container(active_settings)
    app = FastAPI(
        title="Sevenonic Mail Automation",
        version="0.1.0",
        description=(
            "Microsoft Graph mail ingestion, garment document parsing, and monday workflow API"
        ),
    )
    app.state.container = active_container

    def require_admin(x_admin_token: str = Header(default="")) -> None:
        expected = active_container.settings.admin_token
        if not expected:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="ADMIN_TOKEN is not configured",
            )
        if not hmac.compare_digest(x_admin_token, expected):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid admin token",
            )

    @app.get("/healthz")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "environment": active_container.settings.app_env,
            "graph_configured": active_container.graph is not None,
            "monday_configured": active_container.monday_writer is not None,
        }

    async def accept_graph_webhook(
        request: Request, validation_token: str | None, *, lifecycle: bool
    ) -> Response:
        if validation_token is not None:
            return PlainTextResponse(validation_token)
        body = await request.json()
        accepted = 0
        ignored = 0
        for notification in body.get("value", []):
            client_state = str(notification.get("clientState", ""))
            expected = active_container.settings.graph_client_state
            if not expected or not hmac.compare_digest(client_state, expected):
                ignored += 1
                continue
            subscription_id = str(notification.get("subscriptionId", ""))
            subscription = active_container.repository.get_subscription_by_remote_id(
                subscription_id
            )
            if not subscription:
                ignored += 1
                continue
            payload = {
                "mailbox_id": subscription["mailbox_id"],
                "folder_id": subscription["folder_id"],
            }
            dedupe_key = f"{subscription['mailbox_id']}|{subscription['folder_id']}"
            if lifecycle:
                lifecycle_event = str(notification.get("lifecycleEvent", ""))
                if lifecycle_event == "subscriptionRemoved":
                    active_container.repository.enqueue_job(
                        "RECREATE_SUBSCRIPTION", dedupe_key, payload
                    )
                elif lifecycle_event == "reauthorizationRequired":
                    active_container.repository.enqueue_job(
                        "RENEW_SUBSCRIPTION", dedupe_key, payload
                    )
                elif lifecycle_event != "missed":
                    ignored += 1
                    continue
            # Delta is the source of truth after ordinary, missed, renewed, or
            # recreated notifications, so every recognized notification wakes it.
            active_container.repository.enqueue_job("SYNC_MAILBOX", dedupe_key, payload)
            accepted += 1
        return Response(
            content=json.dumps({"accepted": accepted, "ignored": ignored}),
            status_code=status.HTTP_202_ACCEPTED,
            media_type="application/json",
        )

    @app.post("/webhooks/graph")
    async def graph_webhook(
        request: Request,
        validation_token: str | None = Query(default=None, alias="validationToken"),
    ) -> Response:
        return await accept_graph_webhook(request, validation_token, lifecycle=False)

    @app.post("/webhooks/graph/lifecycle")
    async def graph_lifecycle_webhook(
        request: Request,
        validation_token: str | None = Query(default=None, alias="validationToken"),
    ) -> Response:
        return await accept_graph_webhook(request, validation_token, lifecycle=True)

    @app.post("/webhooks/monday")
    async def monday_webhook(request: Request) -> dict[str, Any]:
        body = await request.json()
        if "challenge" in body:
            return {"challenge": body["challenge"]}
        digest = hashlib.sha256(
            json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        active_container.repository.enqueue_job("MONDAY_RECONCILE", digest, {"event": body})
        return {"accepted": True}

    @app.post("/operations/subscriptions/bootstrap", dependencies=[])
    async def bootstrap_subscriptions(
        x_admin_token: str = Header(default=""),
    ) -> dict[str, Any]:
        require_admin(x_admin_token)
        service = active_container.subscription_service
        if not service:
            raise HTTPException(status_code=503, detail="Graph is not configured")
        created = []
        for mailbox in active_container.settings.graph_mailboxes_json:
            created.append(await service.ensure(mailbox.mailbox_id, mailbox.folder_id))
        return {"subscriptions": created}

    @app.post("/operations/mailboxes/{mailbox_id}/folders/{folder_id}/sync")
    async def sync_mailbox(
        mailbox_id: str,
        folder_id: str,
        x_admin_token: str = Header(default=""),
    ) -> dict[str, Any]:
        require_admin(x_admin_token)
        service = active_container.sync_service
        if not service:
            raise HTTPException(status_code=503, detail="Graph is not configured")
        return await service.sync(mailbox_id, folder_id)

    @app.post("/operations/jobs/run-once")
    async def run_jobs(
        limit: int = Query(default=10, ge=1, le=100),
        x_admin_token: str = Header(default=""),
    ) -> dict[str, int]:
        require_admin(x_admin_token)
        return await active_container.job_runner.run_once(limit)

    @app.get("/operations/counts")
    async def counts(x_admin_token: str = Header(default="")) -> dict[str, int]:
        require_admin(x_admin_token)
        return active_container.repository.counts()

    @app.get("/events/{event_id}")
    async def event(event_id: str, x_admin_token: str = Header(default="")) -> dict[str, Any]:
        require_admin(x_admin_token)
        row = active_container.repository.get_event(event_id)
        if not row:
            raise HTTPException(status_code=404, detail="event not found")
        return row

    return app
