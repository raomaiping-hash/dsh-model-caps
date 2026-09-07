# 0003: applyCapsPatch 缺省字段不删除已有值

- 分类：bug-fix
- 状态：implemented
- 日期：2026-09-02

## Problem

`patchEntry` 对 `input`/`efforts` 无条件先校验再写：`validateInput(undefined)` 与
`validateInput(null)`、`validateInput([])` 都归一化为 `{ value: undefined }`，随后
`delete entry.input`——**缺省字段与显式 `null` 被同等对待**。于是
`model_caps {action:"set", provider, model, defaultEffort:"medium"}`（不传
input/efforts）会顺带把该模型已有的 `input` 与 `reasoningEfforts` 删除；
只改 `input` 会抹掉 `efforts`，反之亦然。`defaultEffort` 字段却正确区分了
缺省（保持）与 `null`（删除），三字段语义不一致。

## Decision

补丁只应用**显式出现**的字段：`patchEntry` 用 `'input' in patch` / `'efforts' in patch`
守卫；`setCaps` 组装 patch 时用 `'input' in args` 等条件键。语义固定为：

- 缺省（未给键）= 保持原值
- `null` / `[]` = 删除字段（恢复继承）
- `false`（仅 efforts）= 非思考模型
- 非空值 = 覆盖

## Alternatives considered

1. **保持「缺省即删除」**——与工具描述「可选字段，null 删除」矛盾，且
   `defaultEffort` 已经按缺省=保持实现，三字段不一致；部分 set 会静默丢数据。
2. **set 改成整段 replace 语义**——要求调用方总是回传全量字段，破坏「补丁式」
   工具人机工效，且与官方 Models 页的 path-op 合并语义不符。

## Consequences

- 门禁 `unit` 新增自证测试：缺省 input 保留已有值、显式 efforts 覆盖、显式
  `null` 仍删除。
- `defaultEffort` 既有实现不变；三字段（input/efforts/defaultEffort）语义现一致。
