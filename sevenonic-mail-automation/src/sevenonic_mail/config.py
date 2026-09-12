from __future__ import annotations

import json
from functools import lru_cache

from pydantic import BaseModel, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class MailboxConfig(BaseModel):
    mailbox_id: str
    folder_id: str = "inbox"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"
    log_level: str = "INFO"
    database_url: str = "sqlite:///./data/sevenonic.db"
    artifact_root: str = "./artifacts"
    admin_token: str = ""

    graph_tenant_id: str = ""
    graph_client_id: str = ""
    graph_client_secret: str = ""
    graph_client_state: str = ""
    graph_notification_url: str = ""
    graph_lifecycle_url: str = ""
    graph_mailboxes_json: list[MailboxConfig] = Field(default_factory=list)

    monday_api_token: str = ""
    monday_api_version: str = "2026-07"
    monday_board_id: str = ""
    monday_group_id: str = ""
    monday_event_column_id: str = "event_id"
    monday_style_column_id: str = "style_id"
    monday_revision_column_id: str = "tech_pack_revision"
    monday_review_status_column_id: str = "review_status"
    monday_review_status_label: str = "待人工复核"

    max_attachment_bytes: int = 50 * 1024 * 1024
    max_workbook_uncompressed_bytes: int = 200 * 1024 * 1024
    max_zip_ratio: int = 200
    sync_interval_seconds: int = 15 * 60
    subscription_renew_before_seconds: int = 24 * 60 * 60
    worker_idle_seconds: float = 2.0

    @field_validator("graph_mailboxes_json", mode="before")
    @classmethod
    def parse_mailboxes(cls, value: object) -> object:
        if isinstance(value, str):
            if not value.strip():
                return []
            return json.loads(value)
        return value

    @property
    def graph_configured(self) -> bool:
        return all(
            [
                self.graph_tenant_id,
                self.graph_client_id,
                self.graph_client_secret,
                self.graph_client_state,
            ]
        )

    @property
    def monday_configured(self) -> bool:
        return bool(self.monday_api_token and self.monday_board_id)


@lru_cache
def get_settings() -> Settings:
    return Settings()
