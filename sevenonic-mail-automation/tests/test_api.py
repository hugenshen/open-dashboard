from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select

from sevenonic_mail.app import build_container, create_app
from sevenonic_mail.storage.database import jobs


@pytest.mark.asyncio
async def test_graph_validation_and_notification_enqueue(settings) -> None:
    container = build_container(settings)
    container.repository.upsert_subscription(
        mailbox_id="po@sevenonic.com",
        folder_id="inbox",
        resource="users/po@sevenonic.com/mailFolders/inbox/messages",
        remote_id="sub-1",
        expires_at=None,
    )
    app = create_app(settings=settings, container=container)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        validation = await client.post("/webhooks/graph?validationToken=plain-token")
        assert validation.status_code == 200
        assert validation.text == "plain-token"
        assert validation.headers["content-type"].startswith("text/plain")

        response = await client.post(
            "/webhooks/graph",
            json={
                "value": [
                    {"subscriptionId": "sub-1", "clientState": "test-client-state"},
                    {"subscriptionId": "sub-1", "clientState": "wrong-state"},
                ]
            },
        )
    assert response.status_code == 202
    assert response.json() == {"accepted": 1, "ignored": 1}
    assert container.repository.counts()["jobs"] == 1


@pytest.mark.asyncio
async def test_admin_endpoints_fail_closed(settings) -> None:
    app = create_app(settings=settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        unauthorized = await client.get("/operations/counts")
        response = await client.get(
            "/operations/counts", headers={"X-Admin-Token": "test-admin-token"}
        )

    assert unauthorized.status_code == 401
    assert response.status_code == 200
    assert response.json()["mail_copies"] == 0


@pytest.mark.asyncio
async def test_monday_challenge_is_echoed(settings) -> None:
    app = create_app(settings=settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/webhooks/monday", json={"challenge": "abc123"})

    assert response.status_code == 200
    assert response.json() == {"challenge": "abc123"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("lifecycle_event", "expected_job_types"),
    [
        ("missed", {"SYNC_MAILBOX"}),
        ("reauthorizationRequired", {"RENEW_SUBSCRIPTION", "SYNC_MAILBOX"}),
        ("subscriptionRemoved", {"RECREATE_SUBSCRIPTION", "SYNC_MAILBOX"}),
    ],
)
async def test_graph_lifecycle_events_create_recovery_jobs(
    settings, lifecycle_event: str, expected_job_types: set[str]
) -> None:
    container = build_container(settings)
    container.repository.upsert_subscription(
        mailbox_id="po@sevenonic.com",
        folder_id="inbox",
        resource="users/po@sevenonic.com/mailFolders/inbox/messages",
        remote_id="sub-life",
        expires_at=None,
    )
    app = create_app(settings=settings, container=container)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/webhooks/graph/lifecycle",
            json={
                "value": [
                    {
                        "subscriptionId": "sub-life",
                        "clientState": "test-client-state",
                        "lifecycleEvent": lifecycle_event,
                    }
                ]
            },
        )

    assert response.status_code == 202
    assert response.json() == {"accepted": 1, "ignored": 0}
    with container.repository.engine.connect() as connection:
        actual_job_types = set(connection.execute(select(jobs.c.job_type)).scalars())
    assert actual_job_types == expected_job_types
