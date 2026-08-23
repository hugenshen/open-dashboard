-- New registrants are role=analyst; they must not inherit every existing board/dataset.
-- Copy former analyst-role grants onto the demo user u_analyst, then drop the role grants.

INSERT INTO od_resource_acl (
    id, workspace_id, resource_type, resource_id, subject_type, subject_id, action, created_at, created_by
)
SELECT
    'acl-u-analyst-' || a.workspace_id || '-' || left(a.resource_type, 3) || '-' || a.resource_id,
    a.workspace_id,
    a.resource_type,
    a.resource_id,
    'user',
    'u_analyst',
    a.action,
    a.created_at,
    'system'
FROM od_resource_acl a
WHERE a.subject_type = 'role'
  AND a.subject_id = 'analyst'
ON CONFLICT DO NOTHING;

DELETE FROM od_resource_acl
 WHERE subject_type = 'role'
   AND subject_id = 'analyst';

-- Existing dashboards: creator keeps owner in workspaces they belong to.
INSERT INTO od_resource_acl (
    id, workspace_id, resource_type, resource_id, subject_type, subject_id, action, created_at, created_by
)
SELECT
    'acl-own-d-' || wm.workspace_id || '-' || d.id::text,
    wm.workspace_id,
    'dashboard',
    d.id::text,
    'user',
    d.create_by,
    'owner',
    0,
    'system'
FROM de_dashboard d
JOIN od_workspace_member wm
  ON wm.user_id = d.create_by
 AND wm.status = 'active'
WHERE d.node_type = 'dashboard'
  AND d.create_by IS NOT NULL
  AND d.create_by NOT IN ('', 'system')
ON CONFLICT DO NOTHING;
