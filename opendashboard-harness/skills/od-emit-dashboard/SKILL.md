# Skill: od-emit-dashboard

Dashboard write path is only `od_emit_patch` → Java `apply-patch`.

- Default multi-turn: `mode=append` when `linkedDashboardId` exists  
- Explicit replace only when user asks 重新生成 / 整页 / 从零  
- Always call `od_get_board_summary` before append  
- Compose via `od_compose_board` (platform helper) or LLM-produced Patch JSON validated by Java
