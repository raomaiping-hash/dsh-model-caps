# 0002: 客户端写路径改用 ctx.remote.settings.mutate（环境事实）

- 分类：bug-fix
- 状态：implemented
- 日期：2026-09-02

## Problem

客户端面板的「保存」走 `ctx.get("connection").api.settings.mutate({...})`，但
`connection` 服务（`dsh-client-connection`）只提供
`{ isLoopback, generation, state, rpc, reconnect, registerGenerationSource, start }`，
**没有 `.api` 成员**——`api === undefined`，点保存抛
`TypeError: Cannot read properties of undefined (reading 'settings')`，整个保存面失效。

即便 `.api` 存在，应答形状与冲突码也对不上：代码用 `response.result.ok` 与
`code === "settings-conflict"`，而 Remote 写应答是扁平 `{ ok, error }`，冲突码是
`settings/conflict`（`settings` 服务抛 `SettingsConflictError`，Remote 网关按
`RemoteErrorDetailsMap['settings/conflict']` 编码 `{ ns, expected, actual }`）。

## Decision

写路径与官方 Models 页一致：经 **`ctx.remote.settings.mutate(ns, ops, expectedRevision)`**
（位置参数），应答取 `response.ok` / `response.error.code` / `response.error.message`，
冲突码判 `"settings/conflict"`。`inject` 改为
`["slots", "remote", "remote.settings", "settingsScope"]`，去掉 `connection`。

## Alternatives considered

1. **给 `connection` 补 `.api`**——`connection` 是传输/流生命周期层，不属于业务
   Remote 命名空间；补一个 `.api` 会引入跨层耦合，且与官方客户端全部走
   `ctx.remote.*` 的惯例背离。
2. **裸 `fetch("/api/...")` 直接发 RPC**——绕过 Remote 码分类与浏览器信任栅栏，
   还要自造鉴权/codec，不可取。

## Consequences

- 保存与官方 Models 页同走 Remote `settings` 命名空间，乐观锁（`expectedRevision`
  → `settings/conflict`）真正生效；冲突后硬刷新底稿、保留草稿的恢复路径沿用。
- 环境事实固化：`connection` 服务无 `.api`；Remote 写应答是扁平 `{ok,error}`
  而非 `{result}` 包裹。
