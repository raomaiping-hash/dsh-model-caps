#!/usr/bin/env node
/**
 * dsh-model-caps 门禁：机械检查 + 自证测试（每个门禁有用非法样例证明会拒绝的测试）。
 * 按改动面跑最窄证据：node scripts/gates/run.mjs [gate ...]
 * 全部门禁：freshness entry unit client links
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const only = process.argv.slice(2);
let failures = 0;

async function runGate(name, fn) {
  if (only.length > 0 && !only.includes(name)) return;
  try {
    const detail = await fn();
    console.log(`✓ ${name}: ${detail ?? ''}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}: ${error?.message ?? String(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/* ---------- freshness：生成物与源码同步 ---------- */
await runGate('freshness', () => {
  const run = spawnSync(process.execPath, ['scripts/build-client.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert(run.status === 0, `build-client --check 失败:\n${run.stdout}${run.stderr}`);
  return 'lib/client.js 与 src/client-body.js 同步';
});

/* ---------- entry：Node half 契约 ---------- */
await runGate('entry', async () => {
  const entryPath = path.join(root, 'lib', 'index.js');
  const mod = await import(entryPath);
  assert(typeof mod.name === 'string' && mod.name.length > 0, 'name 必须是非空字符串');
  assert(Array.isArray(mod.inject), 'inject 必须是数组');
  assert(typeof mod.apply === 'function', 'apply 必须是函数');
  for (const needed of ['settings', 'tools']) {
    assert(mod.inject.includes(needed), `inject 必须声明 ${needed}（0811 严格注入）`);
  }
  // 非法样例自证：apply 在缺服务时静默返回，不抛错（可安全挂载到无 tools 的宿主）
  let registered = [];
  const fakeCtx = {
    settings: undefined,
    tools: undefined,
  };
  mod.apply(fakeCtx);
  assert(registered.length === 0, '无服务时不应注册工具');
  // 合法样例：工具注册 + execute 各 action 行为
  const descriptor = {
    ns: 'llm-pi-ai',
    value: { providers: { demo: { displayName: 'Demo', models: [{ id: 'm1', contextWindow: 100 }] } } },
    user: { providers: { demo: { displayName: 'Demo', models: [{ id: 'm1' }] } } },
  };
  const fakeSettings = {
    describe: () => [descriptor],
    mutate: async (_ns, ops) => {
      registered.push({ _ns, ops });
      return { ok: true };
    },
  };
  const toolDefs = [];
  const fullCtx = { settings: fakeSettings, tools: { register: (def) => toolDefs.push(def) } };
  mod.apply(fullCtx);
  assert(toolDefs.length === 1, '应恰好注册一个工具');
  assert(toolDefs[0].name === 'model_caps', '工具名应为 model_caps');
  const out1 = await toolDefs[0].execute({ action: 'list' });
  assert(/demo\/m1/.test(out1.text), `list 应含 demo/m1，得到: ${out1.text}`);
  return 'entry 契约 + 注册行为通过';
});

/* ---------- unit：纯逻辑合法+非法样例 ---------- */
async function unitGate() {
  const mod = await import(path.join(root, 'lib', 'index.js'));
  // validateEfforts 合法样例
  assert(mod.validateEfforts(false).value === false, 'false 应放行');
  assert(mod.validateEfforts(null).ok, 'null 应放行(删除语义)');
  const dict = mod.validateEfforts({ off: null, low: 'low' });
  assert(dict.ok && dict.value.low === 'low', 'off:null + low 应放行并归一化');
  assert(mod.validateEfforts({ low: '' }).ok === false, '非法样例：空 wire 值必须被拒');
  assert(mod.validateEfforts({}).ok === false, '非法样例：空对象必须被拒');
  assert(mod.validateEfforts({ off: null }).ok === false, '非法样例：只声明 off 必须被拒');
  assert(mod.validateEfforts({ ultra: 'x' }).ok === false, '非法样例：未知档位必须被拒');
  assert(mod.validateEfforts({ high: null }).ok === false, '非法样例：非 off 档位留空必须被拒');
  // validateInput
  assert(mod.validateInput(['text', 'image']).value.length === 2, '双模态放行');
  assert(mod.validateInput(['image', 'image']).value.join() === 'image', '重复模态去重');
  assert(mod.validateInput([]).ok && mod.validateInput([]).value === undefined, '空数组=删除字段语义');
  assert(mod.validateInput(['video']).ok === false, '非法样例：未知模态必须被拒');
  assert(mod.validateInput('text').ok === false, '非法样例：非数组必须被拒');
  // applyCapsPatch：models 条目
  const base = { displayName: 'D', apiKeyEnv: 'X_API_KEY', models: [{ id: 'a', contextWindow: 1 }] };
  let next = mod.applyCapsPatch(base, { model: 'a', input: ['text', 'image'], efforts: { off: null, low: 'low' } });
  assert(next.models[0].input.join() === 'text,image', 'patch 应写入 input');
  assert(next.models[0].reasoningEfforts.off === null, 'patch 应保留 off:null');
  assert(next.apiKeyEnv === 'X_API_KEY', '整段 set 必须保留其余字段');
  assert(base.models[0].input === undefined, 'applyCapsPatch 不得改写入参（structuredClone）');
  // 新模型条目创建 + 字段删除
  next = mod.applyCapsPatch(base, { model: 'b', efforts: null, input: null });
  assert(next.models.some((m) => m.id === 'b'), '应为新模型建条目');
  assert(!('reasoningEfforts' in next.models[1]) && !('input' in next.models[1]), 'null 补丁=字段缺席');
  // 非法补丁被拒
  let threw = false;
  try {
    mod.applyCapsPatch(base, { model: 'a', efforts: { nope: 'x' } });
  } catch {
    threw = true;
  }
  assert(threw, '非法样例：未知档位补丁必须抛错');
  // override 路径
  next = mod.applyCapsPatch(base, { model: 'cat-model', override: true, input: ['text', 'image'] });
  assert(next.modelOverrides['cat-model'].input.join() === 'text,image', 'override 应写 modelOverrides');
  next = mod.applyCapsPatch({ modelOverrides: { x: { input: ['image'] } } }, { model: 'x', override: true, input: null });
  assert(!next.modelOverrides, 'override 条目清空后键应移除');
  // buildSetOps：整段 set 到 providers.<route>
  const ops = mod.buildSetOps('demo', next);
  assert(ops.length === 1 && ops[0].op === 'set' && JSON.stringify(ops[0].path) === '["providers","demo"]', 'ops 必须整段 set providers.<route>（path op 不支持数组寻址）');
  return '纯逻辑合法/非法样例全部通过';
}
await runGate('unit', () => unitGate());

/* ---------- client：bundle 契约 ---------- */
await runGate('client', () => {
  const src = readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');
  assert(src.startsWith('window.__ModuleLoader__.load('), '必须以 __ModuleLoader__.load 开头');
  assert(src.includes('id: "dsh-model-caps"'), '注册 id 必须是包名');
  assert(/exports\.apply = apply/.test(src) && /exports\.inject = inject/.test(src), '必须导出 apply/inject');
  assert(/var inject = \["slots", "connection", "settingsScope"\]/.test(src), 'inject 必须声明 slots/connection/settingsScope');
  assert(src.includes('"settings.section"') && src.includes('"model-caps"'), '必须注册 settings.section 槽位 model-caps');
  assert(src.includes('api.settings.mutate') && src.includes('expectedRevision'), '写入必须走 settings.mutate 且带冲突检测');
  // 非法样例自证：无乐观锁恢复路径的写入面不允许上线（连续保存必踩 settings-conflict）
  assert(src.includes('settings-conflict') && src.includes('reloadHard') && src.includes('freshRevision'), '非法样例：必须处理 settings-conflict（保存时实时取修订号 + 冲突后硬刷新保留草稿）');
  // 思考显示开关：稳定 DOM 标记 + 样式注入 + 持久化键
  assert(src.includes('data-variant="think"') && src.includes('dsh-model-caps-hide-think') && src.includes('dsh-model-caps.hideThinking'), '思考显示开关必须注入 [data-variant="think"] 隐藏样式并持久化偏好');
  assert(src.includes('llm-pi-ai'), '必须指向 llm-pi-ai 命名空间');
  // 非法样例自证：bundle 里不允许 ESM import（client bundle 纯度）
  assert(!/^import\s/m.test(src), '非法样例：client bundle 不允许 ESM import 语句（跨插件值导入被 purity gate 禁止）');
  return '__ModuleLoader__ 契约 + settings 写路径通过';
});

/* ---------- links：README 相对链接 ---------- */
await runGate('links', () => {
  const readmePath = path.join(root, 'README.md');
  assert(existsSync(readmePath), 'README.md 缺失');
  const readme = readFileSync(readmePath, 'utf8');
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let match;
  let checked = 0;
  while ((match = linkPattern.exec(readme)) !== null) {
    const target = match[1];
    if (/^(https?:|#|mailto:)/.test(target)) continue;
    const clean = target.split('#')[0];
    if (!clean) continue;
    assert(existsSync(path.join(root, clean)), `README 链接目标不存在: ${target}`);
    checked += 1;
  }
  return `md-links ok (${checked} 个相对链接)`;
});

if (only.length > 0 && failures === 0 && !['freshness', 'entry', 'unit', 'client', 'links'].some((g) => only.includes(g))) {
  console.log(`没有名为 ${only.join(', ')} 的门禁（可选: freshness entry unit client links）`);
}
if (failures > 0) process.exit(1);
