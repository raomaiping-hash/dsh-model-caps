<h1 align="center">dsh-model-caps</h1>

<p align="center">给 DeepSeek Harness Web 补上自定义模型供应商的<b>思考强度</b>与<b>多模态</b>配置面——官方「模型」页刻意不渲染、但底层 schema 完全支持的两个能力字段。</p>

## 解决什么痛点

DSH 的自定义供应商（`llm-pi-ai.providers.*`，OpenAI 兼容网关/自建中转）在数据层支持每个模型声明：

- **思考强度**：`reasoningEfforts`（`off/minimal/low/medium/high/xhigh/max` → 发往端点的 wire 值）与 provider 级默认档 `reasoning`；
- **多模态**：`input` 请求模态数组（`text`/`image`，决定能否附图）。

但官方 Models 设置页的编辑卡**没有这两个控件**（源码注释明确写着 "There is deliberately no reasoning-effort control, here or on the editor card"）——自定义模型既调不了思考档位，也声明不了图片输入，composer 的模型选择器因此无档位可选。本插件把这两个能力面补齐：一个设置页面板 + 一个 agent 工具，写入实时生效。

## 能力面

| 工具 | 说明 |
|---|---|
| `model_caps` | 查看/设置自定义供应商模型的思考档位（含 wire 值）、图片输入模态、provider 默认档；`action=list/get/set`，写入经 settings 冲突检测、pi-ai 热重挂载即时生效 |

| 设置面板（设置 → 模型能力） | 说明 |
|---|---|
| 思考档位编辑器 | 每模型三态：继承 / 非思考模型（`false`）/ 自定义档位（勾选档位 + wire 值，`off` 特殊声明为"发送时不带思考参数"）；预设：标准（off+low/medium/high）、全部（七档） |
| 多模态开关 | 每模型勾选「图片输入」→ `input: ["text","image"]`，取消勾选恢复继承 |
| 默认思考档 | provider 级 `reasoning` 下拉（模型选择器的缺省档位） |
| 思考显示开关 | 「隐藏思考过程」：隐藏聊天界面 Think 折叠行（`data-variant="think"`），即时生效、localStorage 持久（每浏览器）；模型照常思考入库。轨迹视图的 Thinking 块暂不受控 |
| 安全写入 | 整段 set `providers.<route>`（settings path op 不支持数组元素寻址），带 `expectedRevision` 冲突检测；非法档位声明会被 pi-ai 的写入校验当场拒绝并显示原因 |

## 安装

```sh
cd dsh-model-caps && dsh plugin --profile web add .
```

纯 cordis 插件：`add` 装依赖进 profile 后，在 `~/.dsh/profiles/web/cordis.patch.yml` 加 insert 行（配置 HMR 实时挂载，无需重启 web）：

```yaml
- insert:
    - id: model-caps
      name: 'dsh-model-caps'
```

改 `lib/index.js`（Node half）后需重启 web（ESM 缓存）；改 `src/client-body.js` 后 `node scripts/build-client.mjs` 重建 + 重装 + 刷新页面即可。

## agent 用法（model_caps 工具）

```
model_caps {action:"list"}                                          # 列出全部供应商/模型的能力现状
model_caps {action:"set", provider:"newapi", model:"gpt-5.6-luna",
            input:["text","image"],                                  # 开图片输入
            efforts:{"off":null,"low":"low","medium":"medium","high":"high"},
            defaultEffort:"medium"}                                  # provider 默认档
model_caps {action:"set", provider:"tx", model:"Deepseek-v4-flash", efforts:false}   # 声明为非思考模型
model_caps {action:"set", provider:"openrouter", model:"stealth/ox-alpha",
            efforts:{"off":null,"high":"high"}, override:true}       # 写 modelOverrides（补丁目录模型）
```

`efforts` 取值：档位→wire 字符串的字典（`off` 可为 `null`=支持关闭）、`false`（非思考模型）、`null`（删除声明恢复继承）。wire 值是实际发往端点的字符串（如 OpenAI 兼容网关的 `low`/`medium`/`high`，或按端点要求写 budget 值）。

## 门禁

```sh
node scripts/gates/run.mjs        # 全套：freshness entry unit client links
node scripts/gates/run.mjs unit   # 按改动面跑最窄证据
```

每个门禁含非法样例自证测试（空档位字典、未知模态、未知档位、bundle ESM import 等都会被证明拒绝）。

## 插件管理

已装插件用 plugin-registry 的**薄控制台**管理（浏览器面板）：管理 profile 插件安装态（bundle 层栈 + insert 行 + 启停），无需手改配置。安装：`dsh plugin --profile web add <plugin-registry>/packages/plugin/console`

## 设计要点

- 写路径与官方 Models 页一致：settings path op 只能走 plain object，数组子路径会被整体替换，因此模型条目修改必须整段 set `providers.<route>`（见 [decisions/implemented/0001-settings-write-path.md](decisions/implemented/0001-settings-write-path.md)）。
- 编辑基底取 namespace 描述符的 **user 层**（稀疏），不把 schema 默认值烧进 `settings.yaml`。
- 客户端读走共享 settings mirror（ui-settings 底座维护，`settings/document-updated` 自动刷新），写走 `connection.api.settings.mutate`。
- 零官方包依赖声明——`@deepseek-ai/*` 由 profile pnpm 闭包注入，公共 npm 解析不到。
