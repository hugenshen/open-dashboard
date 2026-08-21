-- Super admin can govern every workspace; workspace admin stays scoped to memberships.

INSERT INTO od_permission (code, name, group_name, description) VALUES
  ('platform:admin', '超级管理员', 'manage', '管理全部工作区、成员和发布范围')
ON CONFLICT (code) DO NOTHING;

INSERT INTO od_role (code, name, description) VALUES
  ('platform_admin', '超级管理员', '管理全部工作区')
ON CONFLICT (code) DO NOTHING;

INSERT INTO od_role_permission (role_code, permission_code) VALUES
  ('platform_admin', 'conversation:use'),
  ('platform_admin', 'dataset:use'),
  ('platform_admin', 'dashboard:view'),
  ('platform_admin', 'dashboard:manage'),
  ('platform_admin', 'report:view'),
  ('platform_admin', 'report:manage'),
  ('platform_admin', 'datasource:manage'),
  ('platform_admin', 'dataset:manage'),
  ('platform_admin', 'knowledge:manage'),
  ('platform_admin', 'workspace:manage_member'),
  ('platform_admin', 'workspace:admin'),
  ('platform_admin', 'platform:admin')
ON CONFLICT DO NOTHING;

INSERT INTO od_menu_permission (menu_key, permission_code) VALUES
  ('datasources', 'platform:admin'),
  ('datasets', 'platform:admin'),
  ('dimensions', 'platform:admin'),
  ('workspaceAdmin', 'platform:admin')
ON CONFLICT DO NOTHING;
