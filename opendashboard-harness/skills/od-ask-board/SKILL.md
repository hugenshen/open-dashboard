# Skill: od-ask-board

Ask/insight over OD datasets without NL2SQL migration.

1. `od_get_schema` for bound datasets  
2. `od_run_query` with encode (platform executes)  
3. Optional: dump sample rows to DeerFlow sandbox → `data-analysis` skill  
4. Emit `answer_table` / `answer_chart` / `answer_insight` — never persist result rows into dashboard layout
