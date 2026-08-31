/**
 * dsh-model-caps — host half.
 *
 * 解决痛点：官方 Models 设置页不暴露自定义模型供应商的
 *   1) 思考强度档位（per-model `reasoningEfforts` + profile 级默认档 `reasoning`）
 *   2) 多模态能力（per-model `input` 模态数组）
 * 底层 schema（dsh-llm-pi-ai）完全支持这些字段，只是官方 UI 没渲染。
 *
 * 本 half 注册 `model_caps` 工具，经 settings 服务读写 `llm-pi-ai` 命名空间；
 * 写入触发 pi-ai 适配器的 onChange 重挂载（实时生效，无需重启 web）。
 *
 * 写路径约束：settings path op 只能走 plain object（dsh-settings applyPathOp
 * 对数组子路径会整体替换），因此修改模型条目必须**整段 set**
 * `providers.<route>` profile 对象——与官方 Models 页 pathOps 的做法一致。
 * 编辑基底取 namespace 描述符的 `user` 层（稀疏），避免把 schema 默认值
 * 烧进 settings.yaml。
 *
 * 零 import：官方包由 profile pnpm 闭包注入，公共 npm 解析不到，不能声明。
 */

export const name = 'dsh-model-caps';

export const inject = ['settings', 'tools'];

const NS = 'llm-pi-ai';

/** pi-ai 思考档位词表（escalation order），与 dsh-llm-pi-ai THINKING_LEVELS 对齐。 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** 请求模态词表，与 dsh-llm-pi-ai MODALITIES 对齐。 */
export const MODALITIES = ['text', 'image'];

/** 校验思考档位声明：false（非思考模型）/ null（删除字段）/ dict（level→wire）。 */
export function validateEfforts(efforts) {
	if (efforts === null || efforts === undefined) return { ok: true, value: undefined };
	if (efforts === false) return { ok: true, value: false };
	if (typeof efforts !== 'object' || Array.isArray(efforts)) {
		return { ok: false, error: `reasoningEfforts 必须是 false、null 或 {档位: wire值} 对象，得到 ${typeof efforts}` };
	}
	const keys = Object.keys(efforts);
	if (keys.length === 0) {
		return { ok: false, error: 'reasoningEfforts 不能为空对象：声明档位（如 {low:"low"}）、设 false（非思考模型）或传 null 删除字段' };
	}
	const normalized = {};
	for (const level of keys) {
		if (!THINKING_LEVELS.includes(level)) {
			return { ok: false, error: `未知思考档位 "${level}"；可选：${THINKING_LEVELS.join(', ')}` };
		}
		const wire = efforts[level];
		if (wire === null || wire === undefined) {
			if (level !== 'off') return { ok: false, error: `档位 "${level}" 缺 wire 值（dispatch 要发送的字符串）；只有 off 可以留空` };
			normalized[level] = null;
			continue;
		}
		if (typeof wire !== 'string' || wire.length === 0) {
			return { ok: false, error: `档位 "${level}" 的 wire 值必须是非空字符串` };
		}
		normalized[level] = wire;
	}
	if (!Object.keys(normalized).some((level) => level !== 'off')) {
		return { ok: false, error: 'reasoningEfforts 只声明了 off：至少要有一个思考档位，或整体设 false 表示非思考模型' };
	}
	return { ok: true, value: normalized };
}

/** 校验模态数组：null/[] → 删除字段（继承），否则必须是 MODALITIES 的非空子集。 */
export function validateInput(input) {
	if (input === null || input === undefined) return { ok: true, value: undefined };
	if (!Array.isArray(input)) return { ok: false, error: `input 必须是模态数组（${MODALITIES.join('/')}）` };
	if (input.length === 0) return { ok: true, value: undefined };
	const bad = input.filter((m) => !MODALITIES.includes(m));
	if (bad.length > 0) return { ok: false, error: `未知模态 ${bad.map((m) => JSON.stringify(m)).join(', ')}；可选：${MODALITIES.join(', ')}` };
	return { ok: true, value: [...new Set(input)] };
}

/** 校验默认思考档位：null → 删除 profile.reasoning；否则必须是合法档位。 */
export function validateDefaultEffort(level) {
	if (level === null || level === undefined) return { ok: true, value: undefined };
	if (!THINKING_LEVELS.includes(level)) {
		return { ok: false, error: `未知默认档位 "${level}"；可选：${THINKING_LEVELS.join(', ')}` };
	}
	return { ok: true, value: level };
}

/**
 * 在稀疏 user 层 profile 上应用一次能力修改，返回整段 set 用的 profile 对象。
 * 纯函数（门禁直测）。patch 字段全可选：
 *   { model, input?, efforts?, defaultEffort?, override? }
 */
export function applyCapsPatch(baseProfile, patch) {
	const profile = structuredClone(baseProfile ?? {});
	if (!Array.isArray(profile.models)) profile.models = [];
	const { model, override = false } = patch;

	if (override) {
		if (typeof model !== 'string' || model.length === 0) throw new Error('override 模式需要 model id（写到 profile.modelOverrides）');
		profile.modelOverrides = { ...profile.modelOverrides };
		const entry = { ...profile.modelOverrides[model] };
		patchEntry(entry, patch);
		if (Object.keys(entry).length === 0) delete profile.modelOverrides[model];
		else profile.modelOverrides[model] = entry;
		if (Object.keys(profile.modelOverrides).length === 0) delete profile.modelOverrides;
		return profile;
	}

	let index = profile.models.findIndex((m) => m && m.id === model);
	if (index < 0) {
		if (typeof model !== 'string' || model.length === 0) throw new Error('需要 model id（provider 下不存在可定位的模型条目）');
		profile.models.push({ id: model });
		index = profile.models.length - 1;
	}
	const entry = { ...profile.models[index] };
	patchEntry(entry, patch);
	profile.models[index] = entry;
	return profile;
}

function patchEntry(entry, patch) {
	const input = validateInput(patch.input);
	if (!input.ok) throw new Error(input.error);
	if (input.value === undefined) delete entry.input;
	else entry.input = input.value;

	const efforts = validateEfforts(patch.efforts);
	if (!efforts.ok) throw new Error(efforts.error);
	if (efforts.value === undefined) delete entry.reasoningEfforts;
	else entry.reasoningEfforts = efforts.value;
}

/** 组装整段 set 的 mutate ops。 */
export function buildSetOps(provider, profile) {
	return [{ op: 'set', path: ['providers', provider], value: profile }];
}

/** 从 namespace 描述符取 (user 层 profile, resolved 层 profile)。 */
export function locateProvider(descriptor, provider) {
	const user = descriptor?.user?.providers?.[provider];
	const resolved = descriptor?.value?.providers?.[provider];
	return { user, resolved };
}

/** 人类可读的单模型能力摘要。 */
export function describeModel(providerName, entry, overrides) {
	const id = entry?.id ?? '(?)';
	const input = Array.isArray(entry?.input) && entry.input.length > 0 ? entry.input.join('+') : 'text(继承)';
	const efforts = entry?.reasoningEfforts;
	let effortText;
	if (efforts === false) effortText = '非思考模型';
	else if (efforts && typeof efforts === 'object') {
		effortText = Object.entries(efforts)
			.map(([level, wire]) => (level === 'off' && wire === null ? 'off' : `${level}→${wire}`))
			.join(', ');
	} else effortText = '未声明(继承)';
	const overrideNote = overrides && Object.keys(overrides).length > 0 ? ' [有override]' : '';
	return `- ${providerName}/${id}: input=${input}; efforts=${effortText}${overrideNote}`;
}

export function apply(ctx) {
	if (!ctx.settings || !ctx.tools) return;

	const readDescriptor = () => {
		const descriptor = (ctx.settings.describe?.() ?? []).find((d) => d.ns === NS);
		if (!descriptor) throw new Error(`settings 命名空间 "${NS}" 未注册——llm-pi-ai 适配器未挂载？`);
		return descriptor;
	};

	const listCaps = () => {
		const descriptor = readDescriptor();
		const providers = descriptor.value?.providers ?? {};
		const routes = Object.keys(providers);
		if (routes.length === 0) return 'llm-pi-ai 下没有已配置的 provider（先在 Models 页添加自定义供应商）。';
		const lines = routes.map((route) => {
			const profile = providers[route] ?? {};
			const models = Array.isArray(profile.models) ? profile.models : [];
			const overrides = profile.modelOverrides ?? {};
			const head = `${route}${profile.displayName ? ` (${profile.displayName})` : ''}${profile.reasoning ? ` 默认档=${profile.reasoning}` : ''}`;
			const body = models.length > 0
				? models.map((m) => describeModel(route, m, overrides[m?.id])).join('\n')
				: '  (无模型条目)';
			return `${head}\n${body}`;
		});
		return ['llm-pi-ai 自定义供应商能力：', ...lines].join('\n');
	};

	const getCaps = (provider, model) => {
		const descriptor = readDescriptor();
		const { resolved } = locateProvider(descriptor, provider);
		if (!resolved) {
			const known = Object.keys(descriptor.value?.providers ?? {});
			throw new Error(`provider "${provider}" 未配置；已配置：${known.join(', ') || '(无)'}`);
		}
		if (model) {
			const entry = (resolved.models ?? []).find((m) => m?.id === model);
			if (!entry) throw new Error(`provider "${provider}" 下没有模型 "${model}"；已有：${(resolved.models ?? []).map((m) => m.id).join(', ') || '(无)'}`);
			return describeModel(provider, entry, resolved.modelOverrides?.[model]);
		}
		const models = (resolved.models ?? []).map((m) => describeModel(provider, m, resolved.modelOverrides?.[m?.id]));
		return `${provider}${resolved.displayName ? ` (${resolved.displayName})` : ''}${resolved.reasoning ? ` 默认档=${resolved.reasoning}` : ''}\n${models.join('\n') || '(无模型条目)'}`;
	};

	const setCaps = async (args) => {
		const descriptor = readDescriptor();
		const { user, resolved } = locateProvider(descriptor, args.provider);
		if (!resolved) {
			const known = Object.keys(descriptor.value?.providers ?? {});
			throw new Error(`provider "${args.provider}" 未配置；已配置：${known.join(', ') || '(无)'}`);
		}
		const defaultEffort = validateDefaultEffort(args.defaultEffort);
		if (!defaultEffort.ok) throw new Error(defaultEffort.error);

		const profile = applyCapsPatch(user ?? {}, {
			model: args.model,
			input: args.input,
			efforts: args.efforts,
			defaultEffort: args.defaultEffort,
			override: args.override === true,
		});
		if (defaultEffort.value === undefined) {
			// defaultEffort 未指定时不动 profile.reasoning；显式 null 已在 applyCapsPatch
			// 语义外——这里补齐删除语义。
			if (args.defaultEffort === null) delete profile.reasoning;
		} else {
			profile.reasoning = defaultEffort.value;
		}

		await ctx.settings.mutate(NS, buildSetOps(args.provider, profile));
		const after = readDescriptor();
		const { resolved: now } = locateProvider(after, args.provider);
		const entry = args.override
			? now?.modelOverrides?.[args.model]
			: (now?.models ?? []).find((m) => m?.id === args.model);
		return [
			`已写入 ${args.provider}/${args.model}${args.override ? ' (modelOverrides)' : ''}，pi-ai 已实时重挂载。`,
			'生效值：' + (entry ? describeModel(args.provider, entry, now?.modelOverrides?.[args.model]) : '(空)'),
			now?.reasoning ? `provider 默认档：${now.reasoning}` : null,
		].filter(Boolean).join('\n');
	};

	ctx.tools.register({
		name: 'model_caps',
		description:
			'查看/设置自定义模型供应商的思考强度档位（reasoningEfforts，含 off/minimal/low/medium/high/xhigh/max 与 wire 值）与多模态能力（input 模态 text/image），以及 provider 级默认思考档。' +
			'action=list 列出全部；action=get 需 provider（可选 model）；action=set 需 provider+model，可选字段：input（模态数组，null 删除）、efforts（档位→wire 值对象 / false 非思考 / null 删除）、defaultEffort（provider 默认档，null 删除）、override（true 写到 modelOverrides 而非 models 条目）。写入实时生效。',
		parameters: {
			type: 'object',
			additionalProperties: false,
			required: ['action'],
			properties: {
				action: { type: 'string', enum: ['list', 'get', 'set'] },
				provider: { type: 'string', description: 'provider 路由 id（llm-pi-ai providers 字典的键，如 newapi/tx/openrouter）' },
				model: { type: 'string', description: '模型 id（provider models 条目的 id）' },
				input: {
					description: 'set：请求模态数组，如 ["text","image"]；null/[] 删除字段（继承默认 text）',
				},
				efforts: {
					description: 'set：思考档位声明，如 {"off":null,"low":"low","high":"high"}；false=非思考模型；null=删除字段',
				},
				defaultEffort: { type: 'string', description: 'set：provider 级默认思考档位；null=删除' },
				override: { type: 'boolean', description: 'set：true 时写到 modelOverrides[model]（补丁目录模型），默认写 models 条目' },
			},
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: { text: { type: 'string' } },
			},
			render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
		},
		async execute(args) {
			try {
				if (args.action === 'list') return { text: listCaps() };
				if (args.action === 'get') {
					if (!args.provider) throw new Error('action=get 需要 provider');
					return { text: getCaps(args.provider, args.model) };
				}
				if (args.action === 'set') {
					if (!args.provider || !args.model) throw new Error('action=set 需要 provider 和 model');
					return { text: await setCaps(args) };
				}
				throw new Error(`未知 action "${args.action}"`);
			} catch (error) {
				return { text: `model_caps 失败：${error?.message ?? String(error)}` };
			}
		},
	});
}
