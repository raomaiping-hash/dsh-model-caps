# 0001: 模型能力写入走整段 set providers.<route>

- 分类：feature / architecture
- 状态：implemented
- 日期：2026-08-22

## Problem

要给自定义供应商模型补 `reasoningEfforts`（思考强度）与 `input`（多模态）配置面，但 dsh-settings 的 path op 只支持 plain object 寻址：`applyPathOp` 遇到数组子路径时把子路径当对象重建（`applyPathOp({}, ...)`），直接写 `providers.<route>.models.<i>.input` 会把整个 `models` 数组替换成普通对象，随后被 pi-ai 的 schema 校验拒绝——数组元素不可寻址。

## Decision

与官方 Models 页一致：修改任何模型字段都**整段 set** `providers.<route>` profile 对象（一个 op），编辑基底取 namespace 描述符的 **user 层**（稀疏、未过 schema 默认值），用 `structuredClone` 后打补丁。客户端与服务端工具共用该约定。

## Alternatives considered

1. **逐元素 path op**（`['providers', route, 'models', '0', 'input']`）——被 applyPathOp 的非 plain-object 分支破坏，schema 校验拒绝，不可行。
2. **以 resolved 值为编辑基底**——会把 schema 默认值（streamIdleTimeoutMs、defaultInput 等）烧进 settings.yaml，钉死未来默认值演进；改用 user 层避免。
3. **绕过 settings 服务直接改 settings.yaml**——绕过 pi-ai 写入校验（assertServiceable）与实时重挂载（onChange → ensureRegistrationFacts/ensureDirectory），失去冲突检测与即时生效。

## Consequences

- 单 op 原子写入 + `expectedRevision` 冲突检测；非法声明（空档位字典、未知模态等）在写入点被拒并命名原因。
- 整段 set 会覆盖同路由的并发细粒度改动——靠 revision 冲突检测兜底，冲突后重读重试。
- user 层稀疏语义要求「删除字段」用键缺席表达；`null` 补丁统一解释为删除。
