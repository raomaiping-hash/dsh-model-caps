window.__ModuleLoader__.load({
  id: "dsh-model-caps",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

/**
 * dsh-model-caps — client half 源码体。
 * 由 scripts/build-client.mjs 包上 __ModuleLoader__ banner/footer 后产出 lib/client.js；
 * 勿手改生成物，改本文件后重新构建。
 *
 * 面板：设置 → 「模型能力」。逐 provider/model 编辑：
 *   - 思考强度：reasoningEfforts 档位声明（off/minimal/low/medium/high/xhigh/max → wire 值）
 *     与 provider 级默认档（profile.reasoning）——官方 Models 页刻意不渲染的字段。
 *   - 多模态：input 模态数组（text/image 图片输入开关）。
 * 写路径与官方一致：整段 set providers.<route>（path op 不支持数组元素寻址），
 * 经 connection.api.settings.mutate 带 expectedRevision 冲突检测；写入后 pi-ai
 * 适配器实时重挂载，无需重启 web。
 */
var React = require("react")

var NS = "llm-pi-ai"

/** 面板级保存串行化：settings 修订号是命名空间共享的，并发保存必然互踩冲突。 */
var saveInFlight = 0

/* ---------- 思考显示开关（纯客户端偏好，localStorage 持久化） ----------
 * 官方 UI 没有"思考是否显示"设置：ReasoningRow 无条件渲染可折叠 Think 行。
 * 该行带稳定 DOM 标记 data-variant="think"，一条 !important 规则即可整体隐藏。
 * 范围：聊天界面；轨迹视图的 Thinking 块是 hash 类名，无稳定钩子，v1 不覆盖。
 * 持久化：localStorage（每浏览器）；跨设备同步留待后续升级 settings namespace。
 */
var HIDE_KEY = "dsh-model-caps.hideThinking"
var HIDE_STYLE_ID = "dsh-model-caps-hide-think"

function readHidePref() {
  try {
    return window.localStorage.getItem(HIDE_KEY) === "1"
  } catch (error) {
    return false
  }
}

function writeHidePref(on) {
  try {
    window.localStorage.setItem(HIDE_KEY, on ? "1" : "0")
  } catch (error) {}
}

function applyHideStyle(on) {
  if (typeof document === "undefined") return
  var existing = document.getElementById(HIDE_STYLE_ID)
  if (on && !existing) {
    var tag = document.createElement("style")
    tag.id = HIDE_STYLE_ID
    tag.dataset.plugin = "dsh-model-caps"
    tag.textContent = '[data-variant="think"]{display:none !important}'
    document.head.appendChild(tag)
  } else if (!on && existing) {
    existing.remove()
  }
}

/** pi-ai THINKING_LEVELS（escalation order）。 */
var LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
/** 档位的默认 wire 拼写；off 声明为 null（支持关闭，发送时不带参数）。 */
function defaultWire(level) {
  return level === "off" ? null : level
}
var PRESETS = [
  { name: "标准", dict: { off: null, low: "low", medium: "medium", high: "high" } },
  {
    name: "全部",
    dict: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
  },
]

var CARD = {
  border: "1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 12%))",
  borderRadius: 10,
  padding: "12px 14px",
  marginBottom: 12,
  background: "var(--dsw-specific-sidebar-fill, transparent)",
}
var ROW = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "3px 0" }
var LABEL = { fontSize: 12, color: "var(--dsw-alias-label-secondary, #61666b)" }
var INPUT = {
  fontSize: 12,
  padding: "2px 6px",
  borderRadius: 6,
  border: "1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 18%))",
  background: "transparent",
  color: "inherit",
  width: 110,
}
var BTN = {
  fontSize: 12,
  padding: "3px 10px",
  borderRadius: 7,
  border: "1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 18%))",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
}
var BTN_PRIMARY = {
  fontSize: 12,
  padding: "3px 12px",
  borderRadius: 7,
  border: "none",
  background: "var(--dsw-alias-brand-l1, #4c6fff)",
  color: "#fff",
  cursor: "pointer",
}
var MONO = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 }

function h(tag, attrs) {
  var children = Array.prototype.slice.call(arguments, 2)
  return React.createElement.apply(React, [tag, attrs].concat(children))
}

function msgOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function jsonEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function clone(value) {
  return value == null ? value : structuredClone(value)
}

/**
 * 插件级数据面：从共享 settings mirror 派生 llm-pi-ai 视图。
 * mirror 由 ui-settings 底座维护（订阅 settings/document-updated 自动重读），
 * 这里只做派生与自己写入后的显式重载。
 */
function createCapsStore(ctx) {
  var face = ctx.settingsScope.describe()
  var state = { status: "loading", error: null, writable: false, revision: 0, resolved: {}, user: {} }
  var listeners = new Set()
  function emit() {
    for (var listener of listeners) listener()
  }
  function derive() {
    var snap = face.getSnapshot()
    var view = snap.view
    if (!view) return
    var rows = Array.isArray(view.namespaces) ? view.namespaces : []
    var nsRow = null
    for (var row of rows) if (row && row.ns === NS) nsRow = row
    if (!nsRow) return
    state = {
      status: "ready",
      error: null,
      writable: view.writable === true,
      revision: typeof nsRow.revision === "number" ? nsRow.revision : 0,
      resolved: (nsRow.value && nsRow.value.providers) || {},
      user: (nsRow.user && nsRow.user.providers) || {},
    }
    emit()
  }
  async function load() {
    try {
      await face.ensure()
      derive()
    } catch (error) {
      state = { status: "error", error: msgOf(error), writable: false, revision: 0, resolved: {}, user: {} }
      emit()
    }
  }
  /** 强制重读宿主文档（ensure 只在首次加载时读，冲突恢复需要硬刷新）。 */
  async function reloadHard() {
    try {
      await face.load()
      derive()
    } catch (error) {
      await load()
    }
  }
  /** 保存时刻的最新修订号——渲染快照可能落后于 mirror 的最新 fold。 */
  function freshRevision() {
    var snap = face.getSnapshot()
    var view = snap.view
    if (view && Array.isArray(view.namespaces)) {
      for (var row of view.namespaces) {
        if (row && row.ns === NS && typeof row.revision === "number") return row.revision
      }
    }
    return state.revision
  }
  return {
    subscribe: function (listener) {
      listeners.add(listener)
      return function () {
        listeners.delete(listener)
      }
    },
    get: function () {
      return state
    },
    reload: load,
    reloadHard: reloadHard,
    freshRevision: freshRevision,
  }
}

/** 草稿里找/建模型条目（稀疏 user 层语义）。 */
function entryOf(draft, modelId, create) {
  if (!Array.isArray(draft.models)) draft.models = []
  for (var entry of draft.models) if (entry && entry.id === modelId) return entry
  if (!create) return null
  var fresh = { id: modelId }
  draft.models.push(fresh)
  return fresh
}

/** 条目是否只剩 id（无实际字段）——可清理。 */
function isEmptyEntry(entry) {
  return entry && Object.keys(entry).length === 1 && "id" in entry
}

/** 自定义档位字典的客户端校验（与服务端 schema 同规则的最小子集）。 */
function effortsError(dict) {
  if (!dict || typeof dict !== "object") return null
  var hasThinking = false
  for (var level of Object.keys(dict)) {
    if (level === "off") continue
    var wire = dict[level]
    if (typeof wire !== "string" || wire.length === 0) return "档位 " + level + " 缺 wire 值"
    hasThinking = true
  }
  if (!hasThinking) return "至少要声明一个思考档位，或改为「关闭/继承」"
  return null
}

/** 档位声明的展示文本。 */
function effortsText(entry) {
  var efforts = entry ? entry.reasoningEfforts : undefined
  if (efforts === false) return "非思考模型"
  if (efforts && typeof efforts === "object") {
    var parts = []
    for (var level of LEVELS) {
      if (!(level in efforts)) continue
      parts.push(level === "off" ? "off" : level + "=" + efforts[level])
    }
    return parts.length > 0 ? parts.join(", ") : "未声明"
  }
  return "继承"
}

function CapsCard(props) {
  var route = props.route
  var resolved = props.resolved
  var original = props.original
  var api = props.api
  var revision = props.revision
  var writable = props.writable

  var [draft, setDraft] = React.useState(function () {
    return clone(original) || {}
  })
  var [busy, setBusy] = React.useState(false)
  var [error, setError] = React.useState(null)
  var [savedAt, setSavedAt] = React.useState(0)

  // 外部数据前进且本地无未保存改动时，跟随新值。
  React.useEffect(
    function () {
      setDraft(function (current) {
        // 仅当草稿与旧 original 一致（无编辑）时才重置，避免覆盖用户输入。
        if (jsonEq(current, original)) return clone(original) || {}
        return current
      })
    },
    [revision],
  )

  var dirty = !jsonEq(draft, original || {})
  var displayName = resolved.displayName || route
  var resolvedModels = Array.isArray(resolved.models) ? resolved.models : []
  var overrides = resolved.modelOverrides || {}

  function update(mutate) {
    setDraft(function (current) {
      var next = clone(current) || {}
      mutate(next)
      return next
    })
    setError(null)
  }

  function setDefaultEffort(level) {
    update(function (next) {
      if (level === "") delete next.reasoning
      else next.reasoning = level
    })
  }

  function toggleImage(modelId, on) {
    update(function (next) {
      var entry = entryOf(next, modelId, true)
      if (on) entry.input = ["text", "image"]
      else delete entry.input
      if (isEmptyEntry(entry)) {
        next.models = next.models.filter(function (m) {
          return m !== entry
        })
      }
    })
  }

  function setEffortsMode(modelId, mode) {
    update(function (next) {
      var entry = entryOf(next, modelId, true)
      if (mode === "inherit") delete entry.reasoningEfforts
      else if (mode === "false") entry.reasoningEfforts = false
      else entry.reasoningEfforts = {}
      if (isEmptyEntry(entry)) {
        next.models = next.models.filter(function (m) {
          return m !== entry
        })
      }
    })
  }

  function toggleLevel(modelId, dict, level) {
    update(function (next) {
      var entry = entryOf(next, modelId, true)
      var target = entry.reasoningEfforts
      if (!target || typeof target !== "object" || target === null || target === false) target = {}
      if (level in target) delete target[level]
      else target[level] = defaultWire(level)
      var keys = Object.keys(target)
      if (keys.length === 0) delete entry.reasoningEfforts
      else entry.reasoningEfforts = target
      if (isEmptyEntry(entry)) {
        next.models = next.models.filter(function (m) {
          return m !== entry
        })
      }
      void dict
    })
  }

  function setWire(modelId, level, wire) {
    update(function (next) {
      var entry = entryOf(next, modelId, true)
      var target = entry.reasoningEfforts
      if (!target || typeof target !== "object" || target === false) target = {}
      target[level] = wire
      entry.reasoningEfforts = target
    })
  }

  function applyPreset(modelId, preset) {
    update(function (next) {
      var entry = entryOf(next, modelId, true)
      entry.reasoningEfforts = clone(preset.dict)
    })
  }

  async function save() {
    var problem = null
    for (var model of draft.models || []) {
      problem = effortsError(model && typeof model.reasoningEfforts === "object" ? model.reasoningEfforts : null)
      if (problem) break
    }
    if (problem) {
      setError(problem)
      return
    }
    if (saveInFlight > 0) {
      setError("上一次保存仍在进行中，稍候再点。")
      return
    }
    setBusy(true)
    setError(null)
    saveInFlight += 1
    try {
      // 修订号取保存时刻的 mirror 最新值（渲染快照可能落后一拍）。
      var response = await api.settings.mutate({
        ns: NS,
        ops: [{ op: "set", path: ["providers", route], value: draft }],
        expectedRevision: props.freshRevision(),
      })
      if (!response.result.ok) {
        var failure = response.result.error
        if (failure && failure.code === "settings-conflict") {
          // 乐观锁拒绝：期间有其他写入（如连续保存/官方 Models 页/其他会话）。
          // 草稿保留，硬刷新底稿后让用户确认重试——不做静默自动重试，
          // 避免整段 set 覆盖别人对同 profile 其他字段的并发修改。
          await props.reloadHard()
          setError(
            "期间有其他写入（" +
              String(failure.message ?? "").replace(/^.*expected revision (\d+), now (\d+).*$/, "rev $1→$2") +
              "）。已加载最新底稿，你的修改已保留——确认无误后再次点「保存」。",
          )
          return
        }
        setError(failure.message)
        return
      }
      setSavedAt(Date.now())
      await props.reload()
    } catch (e) {
      setError(msgOf(e))
    } finally {
      saveInFlight -= 1
      setBusy(false)
    }
  }

  var validationError = null
  for (var model of draft.models || []) {
    validationError = effortsError(model && typeof model.reasoningEfforts === "object" ? model.reasoningEfforts : null)
    if (validationError) break
  }

  return h(
    "div",
    { style: CARD },
    h(
      "div",
      { style: ROW },
      h("strong", { style: { fontSize: 13 } }, displayName),
      h("code", { style: MONO }, route),
      resolved.reasoning ? h("span", { style: LABEL }, "默认档：" + resolved.reasoning) : null,
      h("span", { style: Object.assign({ marginLeft: "auto" }, LABEL) }, dirty ? "有未保存修改" : savedAt ? "已保存 ✓" : ""),
    ),
    h(
      "div",
      { style: ROW },
      h("span", { style: LABEL }, "provider 默认思考档"),
      h(
        "select",
        {
          style: INPUT,
          disabled: !writable || busy,
          value: typeof draft.reasoning === "string" ? draft.reasoning : "",
          onChange: function (event) {
            setDefaultEffort(event.target.value)
          },
        },
        h("option", { value: "" }, "（未设置）"),
        LEVELS.map(function (level) {
          return h("option", { key: level, value: level }, level)
        }),
      ),
      h(
        "span",
        { style: LABEL },
        "模型选择器里该供应商各模型缺省选中的档位；仅当模型声明了该档位时生效",
      ),
    ),
    resolvedModels.length === 0 ? h("div", { style: LABEL }, "（该供应商没有模型条目）") : null,
    resolvedModels.map(function (model) {
      var modelId = model.id
      var draftEntry = null
      for (var candidate of draft.models || []) if (candidate && candidate.id === modelId) draftEntry = candidate
      var imageOn =
        draftEntry && Array.isArray(draftEntry.input)
          ? draftEntry.input.indexOf("image") >= 0
          : Array.isArray(model.input)
            ? model.input.indexOf("image") >= 0
            : false
      var efforts = draftEntry ? draftEntry.reasoningEfforts : undefined
      var mode = efforts === false ? "false" : efforts && typeof efforts === "object" ? "custom" : "inherit"
      var dict = mode === "custom" ? efforts : null
      return h(
        "div",
        {
          key: modelId,
          style: {
            borderTop: "1px dashed var(--dsw-alias-border-l1, rgb(0 0 0 / 10%))",
            marginTop: 8,
            paddingTop: 8,
          },
        },
        h(
          "div",
          { style: ROW },
          h("code", { style: MONO }, modelId),
          overrides[modelId] ? h("span", { style: LABEL }, "[override]") : null,
          h("span", { style: LABEL }, effortsText(model)),
        ),
        h(
          "div",
          { style: ROW },
          h(
            "label",
            { style: Object.assign({ display: "flex", alignItems: "center", gap: 4 }, LABEL) },
            h("input", {
              type: "checkbox",
              disabled: !writable || busy,
              checked: imageOn,
              onChange: function (event) {
                toggleImage(modelId, event.target.checked)
              },
            }),
            "多模态（图片输入）",
          ),
          h("span", { style: LABEL }, "mode:"),
          h(
            "select",
            {
              style: INPUT,
              disabled: !writable || busy,
              value: mode,
              onChange: function (event) {
                setEffortsMode(modelId, event.target.value)
              },
            },
            h("option", { value: "inherit" }, "继承"),
            h("option", { value: "false" }, "非思考模型"),
            h("option", { value: "custom" }, "自定义档位"),
          ),
          mode === "custom"
            ? PRESETS.map(function (preset) {
                return h(
                  "button",
                  {
                    key: preset.name,
                    type: "button",
                    style: BTN,
                    disabled: !writable || busy,
                    onClick: function () {
                      applyPreset(modelId, preset)
                    },
                  },
                  "预设:" + preset.name,
                )
              })
            : null,
        ),
        mode === "custom"
          ? h(
              "div",
              {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  margin: "4px 0 0 16px",
                },
              },
              LEVELS.map(function (level) {
                var declared = dict ? level in dict : false
                return h(
                  "div",
                  { key: level, style: ROW },
                  h("input", {
                    type: "checkbox",
                    disabled: !writable || busy,
                    checked: declared,
                    onChange: function () {
                      toggleLevel(modelId, dict, level)
                    },
                  }),
                  h("code", { style: Object.assign({ width: 52 }, MONO) }, level),
                  declared && level !== "off"
                    ? h("input", {
                        style: INPUT,
                        disabled: !writable || busy,
                        value: dict[level],
                        placeholder: "wire 值",
                        onChange: function (event) {
                          setWire(modelId, level, event.target.value)
                        },
                      })
                    : h("span", { style: LABEL }, declared ? "（声明 off：选择该项时请求不带思考参数）" : ""),
                )
              }),
            )
          : null,
      )
    }),
    error ? h("div", { style: { color: "#d54941", fontSize: 12, marginTop: 6 } }, error) : null,
    validationError ? h("div", { style: { color: "#d54941", fontSize: 12, marginTop: 4 } }, validationError) : null,
    h(
      "div",
      { style: Object.assign({ marginTop: 10 }, ROW) },
      h(
        "button",
        {
          type: "button",
          style: BTN_PRIMARY,
          disabled: !writable || busy || !dirty || validationError != null,
          onClick: function () {
            save()
          },
        },
        busy ? "保存中…" : "保存（整段写入 " + route + "）",
      ),
      dirty
        ? h(
            "button",
            {
              type: "button",
              style: BTN,
              disabled: busy,
              onClick: function () {
                setDraft(clone(original) || {})
                setError(null)
              },
            },
            "放弃修改",
          )
        : null,
    ),
  )
}

/** 思考显示开关行：隐藏/恢复聊天界面的 Think 折叠行（即时生效，localStorage 持久）。 */
function ThinkingVisibilityRow() {
  var [hideThinking, setHideThinking] = React.useState(readHidePref)
  function toggle(event) {
    var on = event.target.checked
    writeHidePref(on)
    applyHideStyle(on)
    setHideThinking(on)
  }
  return h(
    "div",
    {
      style: Object.assign(
        {
          border: "1px dashed var(--dsw-alias-border-l1, rgb(0 0 0 / 14%))",
          borderRadius: 10,
          padding: "8px 12px",
          marginBottom: 12,
        },
        ROW,
      ),
    },
    h(
      "label",
      { style: Object.assign({ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }, {}) },
      h("input", {
        type: "checkbox",
        checked: hideThinking,
        onChange: toggle,
      }),
      "隐藏思考过程（Think 折叠行）",
    ),
    h(
      "span",
      { style: LABEL },
      "仅影响本浏览器的显示：模型照常思考、结果照常入库；要让模型根本不思考，用上方档位选 off 或声明非思考模型。" +
          "轨迹视图的 Thinking 块暂不受控。",
    ),
  )
}

function CapsPanel(props) {
  var store = props.store
  var api = props.api
  var caps = React.useSyncExternalStore(store.subscribe, store.get)

  if (caps.status === "loading") return h("div", { style: LABEL }, "正在读取模型能力设置…")
  if (caps.status === "error")
    return h("div", { style: { color: "#d54941", fontSize: 12 } }, "读取失败：" + caps.error)

  var routes = Object.keys(caps.resolved || {})
  return h(
    "div",
    { style: { maxWidth: 760, paddingBottom: 24 } },
    h(
      "div",
      { style: Object.assign({ marginBottom: 12 }, LABEL) },
      "官方「模型」页不提供自定义供应商的思考强度与多模态配置——本面板补齐这两个能力面。" +
        "写入即实时生效（llm-pi-ai 适配器热重挂载，无需重启）；等价的 agent 工具是 model_caps。",
    ),
    h(ThinkingVisibilityRow),
    !caps.writable
      ? h(
          "div",
          {
            style: Object.assign({
              marginBottom: 12,
              color: "#b58a00",
              fontSize: 12,
            }),
          },
          "当前浏览器对 settings 只读（远程访问经登录墙时为进程内镜像）：请在宿主机 loopback 页面修改。",
        )
      : null,
    routes.length === 0 ? h("div", { style: LABEL }, "llm-pi-ai 下还没有自定义供应商——先到「模型」页添加。") : null,
    routes.map(function (route) {
      return h(CapsCard, {
        key: route,
        route: route,
        resolved: caps.resolved[route] || {},
        original: caps.user[route] || {},
        api: api,
        revision: caps.revision,
        writable: caps.writable,
        reload: store.reload,
        reloadHard: store.reloadHard,
        freshRevision: store.freshRevision,
      })
    }),
  )
}

var inject = ["slots", "connection", "settingsScope"]

function apply(ctx) {
  var store = createCapsStore(ctx)
  store.reload()
  var api = ctx.get("connection").api

  // 页面启动即按已存偏好应用 Think 行显隐（无需先打开本面板）。
  applyHideStyle(readHidePref())

  function ModelCapsSection(propsFromSlot) {
    return h(CapsPanel, { store: store, api: api, close: propsFromSlot && propsFromSlot.close })
  }

  ctx.slots.inject("settings.section", function () {
    return ctx.slots.register(
      {
        name: "settings.section",
        id: "model-caps",
        order: 12,
        label: "模型能力",
      },
      ModelCapsSection,
    )
  })
}

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
