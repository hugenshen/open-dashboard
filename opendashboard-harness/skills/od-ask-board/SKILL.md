# Skill: od-ask-board

Ask/insight over OD datasets. Pipeline copied from SQLBot (`refs/sqlbot` generate-SQL → execute → chart), not JoyAgent.

1. `od_get_schema` for the bound dataset  
2. Generate SELECT-only SQL from M-Schema (identifiers must match schema exactly)  
3. `od_run_sql` — Java executes after sqlglot + table whitelist  
4. Emit `answer_sql` / `answer_table` / `answer_chart` — never persist result rows into dashboard layout  
5. If SQL generation fails, fall back to `od_run_query` encode
