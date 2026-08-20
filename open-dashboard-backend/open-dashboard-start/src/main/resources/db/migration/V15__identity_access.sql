-- Identity, password credentials, sessions and menu permission governance.

CREATE TABLE IF NOT EXISTS od_user_account (
    id                  VARCHAR(64)  NOT NULL PRIMARY KEY,
    username            VARCHAR(128) NOT NULL UNIQUE,
    display_name        VARCHAR(128) NOT NULL,
    email               VARCHAR(256) NULL,
    status              VARCHAR(32)  NOT NULL DEFAULT 'active',
    password_changed_at BIGINT       NULL,
    created_at          BIGINT       NOT NULL,
    updated_at          BIGINT       NOT NULL
);

CREATE TABLE IF NOT EXISTS od_password_credential (
    user_id       VARCHAR(64)  NOT NULL PRIMARY KEY REFERENCES od_user_account(id) ON DELETE CASCADE,
    algorithm     VARCHAR(64)  NOT NULL,
    iterations    INT          NOT NULL,
    salt          VARCHAR(256) NOT NULL,
    password_hash VARCHAR(512) NOT NULL,
    created_at    BIGINT       NOT NULL,
    updated_at    BIGINT       NOT NULL
);

CREATE TABLE IF NOT EXISTS od_auth_session (
    id_hash       VARCHAR(128) NOT NULL PRIMARY KEY,
    user_id       VARCHAR(64)  NOT NULL REFERENCES od_user_account(id) ON DELETE CASCADE,
    workspace_id  VARCHAR(64)  NOT NULL,
    created_at    BIGINT       NOT NULL,
    expires_at    BIGINT       NOT NULL,
    last_seen_at  BIGINT       NOT NULL,
    revoked_at    BIGINT       NULL,
    user_agent    VARCHAR(512) NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_session_user ON od_auth_session (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_exp ON od_auth_session (expires_at);

CREATE TABLE IF NOT EXISTS od_role (
    code        VARCHAR(64)  NOT NULL PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    description VARCHAR(512) NULL
);

CREATE TABLE IF NOT EXISTS od_permission (
    code        VARCHAR(128) NOT NULL PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    group_name  VARCHAR(64)  NOT NULL,
    description VARCHAR(512) NULL
);

CREATE TABLE IF NOT EXISTS od_role_permission (
    role_code       VARCHAR(64)  NOT NULL REFERENCES od_role(code) ON DELETE CASCADE,
    permission_code VARCHAR(128) NOT NULL REFERENCES od_permission(code) ON DELETE CASCADE,
    PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE IF NOT EXISTS od_workspace_member (
    user_id      VARCHAR(64) NOT NULL REFERENCES od_user_account(id) ON DELETE CASCADE,
    workspace_id VARCHAR(64) NOT NULL,
    role_code    VARCHAR(64) NOT NULL REFERENCES od_role(code),
    status       VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at   BIGINT      NOT NULL,
    PRIMARY KEY (user_id, workspace_id, role_code)
);

CREATE INDEX IF NOT EXISTS idx_workspace_member_user ON od_workspace_member (user_id, status);

CREATE TABLE IF NOT EXISTS od_menu_item (
    menu_key    VARCHAR(64)  NOT NULL PRIMARY KEY,
    label       VARCHAR(128) NOT NULL,
    path        VARCHAR(256) NOT NULL,
    group_name  VARCHAR(32)  NOT NULL,
    ord         INT          NOT NULL,
    enabled     BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS od_menu_permission (
    menu_key        VARCHAR(64)  NOT NULL REFERENCES od_menu_item(menu_key) ON DELETE CASCADE,
    permission_code VARCHAR(128) NOT NULL,
    PRIMARY KEY (menu_key, permission_code)
);

INSERT INTO od_permission (code, name, group_name, description) VALUES
  ('conversation:use', '使用对话分析', 'user', '进入对话分析并发起问数'),
  ('dataset:use', '消费数据集', 'data', '查询已授权数据集'),
  ('dashboard:view', '查看仪表盘', 'user', '查看已授权仪表盘'),
  ('dashboard:manage', '管理仪表盘', 'manage', '创建、编辑和发布仪表盘'),
  ('report:view', '查看报告', 'user', '查看已授权报告'),
  ('report:manage', '管理报告', 'manage', '创建、编辑和发布报告'),
  ('datasource:manage', '管理数据源', 'manage', '接入和维护数据源'),
  ('dataset:manage', '管理数据集', 'manage', '发布数据集、字段语义和行列策略'),
  ('knowledge:manage', '维护知识', 'manage', '维护术语、指标和知识库'),
  ('workspace:manage_member', '管理成员', 'manage', '维护工作区成员和项目组'),
  ('workspace:admin', '工作区管理员', 'manage', '工作区全局管理权限')
ON CONFLICT (code) DO NOTHING;

INSERT INTO od_role (code, name, description) VALUES
  ('workspace_admin', '工作区管理员', '管理工作区成员、数据和知识'),
  ('analyst', '分析师', '消费数据资产并进行问数分析'),
  ('viewer', '查看者', '查看已授权看板和报告')
ON CONFLICT (code) DO NOTHING;

INSERT INTO od_role_permission (role_code, permission_code) VALUES
  ('workspace_admin', 'conversation:use'),
  ('workspace_admin', 'dataset:use'),
  ('workspace_admin', 'dashboard:view'),
  ('workspace_admin', 'dashboard:manage'),
  ('workspace_admin', 'report:view'),
  ('workspace_admin', 'report:manage'),
  ('workspace_admin', 'datasource:manage'),
  ('workspace_admin', 'dataset:manage'),
  ('workspace_admin', 'knowledge:manage'),
  ('workspace_admin', 'workspace:manage_member'),
  ('workspace_admin', 'workspace:admin'),
  ('analyst', 'conversation:use'),
  ('analyst', 'dataset:use'),
  ('analyst', 'dashboard:view'),
  ('analyst', 'report:view'),
  ('viewer', 'dashboard:view'),
  ('viewer', 'report:view')
ON CONFLICT DO NOTHING;

INSERT INTO od_menu_item (menu_key, label, path, group_name, ord, enabled) VALUES
  ('workbench', '工作台', '/workbench', 'use', 10, TRUE),
  ('dataPlaza', '数据广场', '/data-plaza', 'use', 20, TRUE),
  ('conversations', '对话分析', '/conversations', 'use', 30, TRUE),
  ('dashboards', '仪表盘', '/dashboards', 'use', 40, TRUE),
  ('reports', '报告', '/reports', 'use', 50, TRUE),
  ('datasources', '数据源', '/datasources', 'manage', 110, TRUE),
  ('datasets', '数据集', '/datasets', 'manage', 120, TRUE),
  ('dimensions', '知识维护', '/dimensions', 'manage', 130, TRUE),
  ('workspaceAdmin', '成员权限', '/workspace-admin', 'manage', 140, TRUE)
ON CONFLICT (menu_key) DO UPDATE
SET label = EXCLUDED.label,
    path = EXCLUDED.path,
    group_name = EXCLUDED.group_name,
    ord = EXCLUDED.ord,
    enabled = EXCLUDED.enabled;

INSERT INTO od_menu_permission (menu_key, permission_code) VALUES
  ('conversations', 'conversation:use'),
  ('dashboards', 'dashboard:view'),
  ('dashboards', 'dashboard:manage'),
  ('reports', 'report:view'),
  ('reports', 'report:manage'),
  ('datasources', 'datasource:manage'),
  ('datasources', 'dataset:manage'),
  ('datasets', 'dataset:manage'),
  ('dimensions', 'dataset:manage'),
  ('dimensions', 'knowledge:manage'),
  ('workspaceAdmin', 'workspace:admin'),
  ('workspaceAdmin', 'workspace:manage_member')
ON CONFLICT DO NOTHING;
