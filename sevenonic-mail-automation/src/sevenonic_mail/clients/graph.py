from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from urllib.parse import quote

import httpx

from sevenonic_mail.domain import DeltaBatch, DeltaMessage


class GraphError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class TokenProvider(Protocol):
    async def get_token(self) -> str: ...


class OAuthClientCredentialsProvider:
    def __init__(
        self,
        tenant_id: str,
        client_id: str,
        client_secret: str,
        *,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self.tenant_id = tenant_id
        self.client_id = client_id
        self.client_secret = client_secret
        self.http = http or httpx.AsyncClient(timeout=20)
        self._token = ""
        self._expires_at = datetime.min.replace(tzinfo=UTC)
        self._lock = asyncio.Lock()

    async def get_token(self) -> str:
        if self._token and datetime.now(UTC) < self._expires_at - timedelta(seconds=60):
            return self._token
        async with self._lock:
            if self._token and datetime.now(UTC) < self._expires_at - timedelta(seconds=60):
                return self._token
            response = await self.http.post(
                f"https://login.microsoftonline.com/{quote(self.tenant_id)}/oauth2/v2.0/token",
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "scope": "https://graph.microsoft.com/.default",
                    "grant_type": "client_credentials",
                },
            )
            if response.status_code >= 400:
                raise GraphError(
                    f"Entra token request failed with HTTP {response.status_code}",
                    status_code=response.status_code,
                )
            data = response.json()
            self._token = str(data["access_token"])
            self._expires_at = datetime.now(UTC) + timedelta(
                seconds=int(data.get("expires_in", 3600))
            )
            return self._token


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class GraphClient:
    def __init__(
        self,
        token_provider: TokenProvider,
        *,
        http: httpx.AsyncClient | None = None,
        base_url: str = "https://graph.microsoft.com/v1.0",
    ) -> None:
        self.token_provider = token_provider
        self.http = http or httpx.AsyncClient(timeout=httpx.Timeout(30, read=120))
        self.base_url = base_url.rstrip("/")

    async def _headers(self, *, immutable: bool = False) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {await self.token_provider.get_token()}"}
        if immutable:
            headers["Prefer"] = 'IdType="ImmutableId"'
        return headers

    async def _json_request(
        self,
        method: str,
        url: str,
        *,
        immutable: bool = False,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = await self.http.request(
            method,
            url,
            headers=await self._headers(immutable=immutable),
            json=json,
        )
        if response.status_code >= 400:
            request_id = response.headers.get("request-id", "unknown")
            raise GraphError(
                f"Graph {method} failed with HTTP {response.status_code}; request-id={request_id}",
                status_code=response.status_code,
            )
        return dict(response.json())

    @staticmethod
    def resource(mailbox_id: str, folder_id: str) -> str:
        mailbox = quote(mailbox_id, safe="@.-_")
        folder = quote(folder_id, safe="-_.~")
        return f"users/{mailbox}/mailFolders/{folder}/messages"

    async def create_subscription(
        self,
        *,
        mailbox_id: str,
        folder_id: str,
        notification_url: str,
        lifecycle_url: str,
        client_state: str,
        expires_at: datetime | None = None,
    ) -> dict[str, Any]:
        # Outlook message subscriptions currently support just under seven days.
        # Six days leaves one full day for proactive renewal and recovery.
        expiration = expires_at or datetime.now(UTC) + timedelta(days=6)
        payload = {
            "changeType": "created,updated,deleted",
            "notificationUrl": notification_url,
            "lifecycleNotificationUrl": lifecycle_url,
            "resource": self.resource(mailbox_id, folder_id),
            "expirationDateTime": expiration.isoformat().replace("+00:00", "Z"),
            "clientState": client_state,
            "latestSupportedTlsVersion": "v1_2",
        }
        return await self._json_request(
            "POST", f"{self.base_url}/subscriptions", immutable=True, json=payload
        )

    async def renew_subscription(
        self, subscription_id: str, expires_at: datetime | None = None
    ) -> dict[str, Any]:
        expiration = expires_at or datetime.now(UTC) + timedelta(days=6)
        return await self._json_request(
            "PATCH",
            f"{self.base_url}/subscriptions/{quote(subscription_id, safe='')}",
            json={"expirationDateTime": expiration.isoformat().replace("+00:00", "Z")},
        )

    async def delta_messages(
        self, mailbox_id: str, folder_id: str, delta_link: str | None = None
    ) -> DeltaBatch:
        mailbox = quote(mailbox_id, safe="@.-_")
        folder = quote(folder_id, safe="-_.~")
        url = delta_link or (
            f"{self.base_url}/users/{mailbox}/mailFolders/{folder}/messages/delta"
            "?$select=id,internetMessageId,subject,receivedDateTime,lastModifiedDateTime,"
            "from,toRecipients,ccRecipients,hasAttachments,isRead"
        )
        messages: list[DeltaMessage] = []
        final_delta_link: str | None = None
        while url:
            data = await self._json_request("GET", url, immutable=True)
            for item in data.get("value", []):
                removed = item.get("@removed") or {}
                messages.append(
                    DeltaMessage(
                        immutable_id=str(item["id"]),
                        internet_message_id=item.get("internetMessageId"),
                        subject=str(item.get("subject", "")),
                        received_at=_parse_datetime(item.get("receivedDateTime")),
                        last_modified_at=_parse_datetime(item.get("lastModifiedDateTime")),
                        has_attachments=bool(item.get("hasAttachments", False)),
                        raw=dict(item),
                        removed_reason=removed.get("reason"),
                    )
                )
            next_link = data.get("@odata.nextLink")
            if next_link:
                url = str(next_link)
                continue
            final_delta_link = data.get("@odata.deltaLink")
            url = ""
        if not final_delta_link:
            raise GraphError("Graph delta response ended without @odata.deltaLink")
        return DeltaBatch(messages=messages, delta_link=str(final_delta_link))

    async def get_mime(self, mailbox_id: str, immutable_id: str) -> bytes:
        mailbox = quote(mailbox_id, safe="@.-_")
        message_id = quote(immutable_id, safe="")
        response = await self.http.get(
            f"{self.base_url}/users/{mailbox}/messages/{message_id}/$value",
            headers=await self._headers(immutable=True),
        )
        if response.status_code >= 400:
            raise GraphError(
                f"Graph MIME download failed with HTTP {response.status_code}",
                status_code=response.status_code,
            )
        return response.content

    async def mail_folder(self, mailbox_id: str, folder_id: str) -> dict[str, Any]:
        mailbox = quote(mailbox_id, safe="@.-_")
        folder = quote(folder_id, safe="-_.~")
        return await self._json_request(
            "GET",
            f"{self.base_url}/users/{mailbox}/mailFolders/{folder}"
            "?$select=id,displayName,parentFolderId,totalItemCount,unreadItemCount",
        )
