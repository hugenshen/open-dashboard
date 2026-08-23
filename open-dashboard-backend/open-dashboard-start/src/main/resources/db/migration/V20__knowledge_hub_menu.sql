-- P010: 管理端入口收敛为「知识库」，路径 /knowledge（/dimensions 由前端重定向）
UPDATE od_menu_item
SET label = '知识库',
    path = '/knowledge'
WHERE menu_key = 'dimensions';
