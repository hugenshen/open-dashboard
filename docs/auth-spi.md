# 可插拔鉴权 SPI（无内置登录页）

Open Dashboard **不绑定** Spring Security / OAuth。业务接口用注解声明权限；身份由可替换的 `AuthProvider` 从请求解析（网关 Header、JWT、SSO Session 等）。

## 默认行为（本地开发）

1. 前端 [`frontend/src/api/http.ts`](../frontend/src/api/http.ts) 自动附带：
   - `X-User-Id`
   - `X-User-Name`
   - `X-User-Perms`（逗号分隔；`*` 表示全部）
2. 默认写入 `localStorage` 键 `od.auth.headers`：演示用户 `demo` / 权限 `*`。
3. 后端 `HeaderAuthProvider` 解析上述 Header；若无 Header 且 `opendashboard.auth.dev-fallback=true`，回落为配置中的演示主体。

生产请关闭 fallback：

```yaml
opendashboard:
  auth:
    dev-fallback: false
```

## 注解

```java
@RequireAuth                          // 需要已解析身份
@RequirePermission("dashboard:manage") // 需要任一权限码；隐含 RequireAuth
```

示例（写操作）：

```java
@PostMapping("/dashboardTree/delete/{id}")
@RequirePermission("dashboard:manage")
public ResponseEntity<Void> delete(@PathVariable String id) { ... }
```

当前主体：`AuthContext.get()` / `AuthContext.userIdOr("system")`（审计字段 `create_by` / `update_by`）。

## 客户接入自家鉴权

实现并注册 **唯一** `AuthProvider` Bean（默认 `HeaderAuthProvider` 带 `@ConditionalOnMissingBean`，会被替换）：

```java
@Component
public class JwtAuthProvider implements AuthProvider {
  @Override
  public Optional<AuthPrincipal> resolve(HttpServletRequest request) {
    String token = request.getHeader("Authorization");
    // 校验 JWT / 调客户 IAM →
    return Optional.of(new AuthPrincipal(userId, displayName, Set.of("dashboard:manage", "dataset:read")));
  }
}
```

菜单同理，实现 `MenuProvider` 替换 `DefaultMenuProvider`：

```java
@Component
public class IamMenuProvider implements MenuProvider {
  @Override
  public List<MenuItem> menus(AuthPrincipal principal) {
    return List.of(new MenuItem("dashboards", "看板", "/dashboards"));
  }
}
```

前端：改 `getAuthHeaders()`（或网关统一注入），把客户 Token 放进请求；`ModuleTopbar` 通过 `GET /api/auth/me`、`GET /api/auth/menus` 展示用户与菜单。

## API

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/auth/me` | 当前主体 |
| GET | `/api/auth/menus` | 当前主体可见菜单 |

## 不在本期

- 登录页 / Session Cookie
- 资源级 ACL 表 `de_dashboard_auth`
- 内置 OAuth2 实现
