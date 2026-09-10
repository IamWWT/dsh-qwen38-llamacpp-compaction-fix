/**
 * dsh-qwen38-gateway-compaction-fix — browser half (self-contained client bundle).
 *
 * Hand-written on purpose: the dsh web shell serves this file verbatim into the
 * page module table (package.json `dsh.client` + `./client` export), so it must
 * be a standalone script that registers one lazy factory through
 * `window.__ModuleLoader__.load`. No build step, no imports beyond the client
 * baseline (react, dsh-client-ui-primitives, dsh-client-store).
 *
 * What it renders:
 *   - the plugin card inside Settings → Plugins → Plugin configuration (the one
 *     home every built-in plugin uses; no extra left-nav entry).
 * It edits the `qwen38-gateway-compaction-fix` settings namespace.
 */
window.__ModuleLoader__.load({
	id: 'dsh-qwen38-gateway-compaction-fix',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require('react');
		const h = React.createElement;
		const { Button, Input, Tag, IconChevronDownOutline14 } = require('@deepseek-ai/dsh-client-ui-primitives');
		const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store');

		/** Settings namespace this card edits (must match the Host half). */
		const NS = 'qwen38-gateway-compaction-fix';

		// ------------------------------------------------------------------
		// Locale dictionaries (flat key -> string, zh primary / en fallback).
		// ------------------------------------------------------------------
		const LOCALES = {
			zh: {
				title: 'Qwen3.8 网关压缩修复',
				description: '让本地网关(llama.cpp 与 NInfer)上的 Qwen3.8 会话压缩可靠完成:辅助调用按引擎写入对应的关思考字段(llama.cpp: chat_template_kwargs.enable_thinking;NInfer: reasoning_effort),并用非思考模式推荐采样参数;超大对话自动分片压缩。保存后实时生效,无需重启。',
				scopeNote: '作用域:本页全部参数只作用于「压缩摘要」与「会话标题」两类辅助调用。正常对话完全不受影响,仍使用你网关(llama.cpp/NInfer)的默认参数。NInfer 模型请把模型 id 同时填入 ninModels(设置页不展示该项,见 settings.yaml),否则会对 NInfer 网关误发 chat_template_kwargs 导致 400。',
				commandHint: '手动操作:在任意会话输入框输入 /qwen38-compact(模型总结,保信息,大会话走分片)或 /qwen38-new-context(硬重置:不调模型、秒级完成、历史丢弃)。极简模式等无内置压缩引擎的会话也可用。',
				basicTitle: '基础设置',
				advancedTitle: '高级参数(仅作用于压缩/标题调用)',
				modelsLabel: '适用模型 ID',
				modelsHint: '逗号分隔,须与 settings.yaml 中 llm-pi-ai providers 声明的模型 id 完全一致;留空则整个策略停用。',
				windowsTitle: '上下文窗口(tokens)——每个模型一行',
				windowsHint: '该模型网关实际运行的上下文窗口(llama.cpp: -c,可用 curl /v1/models 查 context_length;NInfer: n_ctx)。只影响“何时分片”:设小=更早分片(慢一点),设大=可能单次溢出(安全回退)。',
				enableThinkingOffLabel: '压缩/标题调用关闭思考',
				enableThinkingOffHint: '开启:向匹配的辅助请求写入 chat_template_kwargs.enable_thinking=false(Qwen3 在 llama.cpp 上的主开关;对 NInfer 模型自动跳过——NInfer 不认该字段,只走 reasoning_effort)。正常对话不受影响。',
				wireReasoningLabel: 'reasoning_effort 字段值',
				wireReasoningHint: '双保险:同时写入请求体的 reasoning_effort(llama.cpp 与 NInfer 均接受,如 none);留空表示不写该字段。',
				maxTokensFloorLabel: 'max_tokens 下限',
				maxTokensFloorHint: '辅助调用的 max_tokens 至少抬到该值(只升不降),防止客户端上下文钳制吃掉输出预算;0 停用。',
				rescueLabel: '超大对话分片救援',
				rescueHint: '开启:压缩提示词超过单次调用容量时,自动切分逐段摘要再合并,而不是报“无法压缩”。',
				newContextLabel: '硬重置命令 /qwen38-new-context',
				newContextHint: '开启后任意会话可硬重置上下文:不调用模型、秒级完成、历史直接丢弃(环境状态不变)。',
				temperatureLabel: 'temperature',
				topPLabel: 'top_p',
				topKLabel: 'top_k',
				minPLabel: 'min_p',
				presencePenaltyLabel: 'presence_penalty',
				repetitionPenaltyLabel: 'repetition_penalty',
				chunkRatioLabel: '分片输入占比 chunkRatio',
				chunkMaxTokensLabel: '单片摘要上限 chunkMaxTokens',
				mergeMaxTokensLabel: '合并摘要上限 mergeMaxTokens',
				maxChunksLabel: '最大分片数 maxChunks',
				on: '已启用',
				off: '已停用',
				collapse: '收起',
				expand: '展开',
				unsaved: '未保存',
				save: '保存',
				saving: '保存中…',
				discard: '放弃修改',
				overridden: '已覆盖默认值',
				reset: '恢复默认',
				invalidNumber: '请输入数字,或留空使用默认值。',
				saveFailed: '部署未接受这些值,改动仍保留在表单中,请修正后重试。',
				readOnly: '当前部署的设置存储为只读。',
				unavailable: '设置服务暂不可用。',
				wireOmit: '不写该字段',
				rescueOffNote: '依赖「超大对话分片救援」开启——当前已停用,以上项不生效(配置保留)。',
				// Hover tooltips (label title attribute): each states the field's
				// dependencies explicitly — “独立项” or which switch gates it.
				tipModels: '根开关(其余全部依赖它):留空则整个插件策略停用——本页其他参数全部不生效。逗号分隔,须与 settings.yaml 中 llm-pi-ai providers 声明的模型 id 完全一致。',
				tipEnableThinkingOff: '独立项(不依赖其他项)。开启:向匹配的压缩/标题请求写入 chat_template_kwargs.enable_thinking=false(Qwen3 在 llama.cpp 上的主开关)。与「reasoning_effort 字段值」是双保险关系,二者可各自独立开关。正常对话不受影响。',
				tipWireReasoning: '独立项(不依赖其他项)。下拉选择写入请求体 reasoning_effort 的值(llama.cpp 接受 none/low/medium/high);选「不写该字段」则省略。与「压缩/标题调用关闭思考」互为双保险。',
				tipMaxTokensFloor: '独立项(不依赖其他项)。辅助调用的 max_tokens 至少抬到该值(只升不降),防止客户端上下文钳制吃掉输出预算;0 停用。',
				tipChunkingEnabled: '「分片救援」组的总开关(5 项依赖它):上下文窗口 + chunkRatio/chunkMaxTokens/mergeMaxTokens/maxChunks。停用后这些项变灰且不生效(配置仍保留,只是不使用)。',
				tipWindows: '依赖①「超大对话分片救援」开启;②模型 id 出现在「适用模型 ID」列表里。填该模型 llama-server 实际运行的 -c(Unsloth 改过 -c 或换 GGUF 后用 curl /v1/models 查 context_length 同步过来)。只影响“何时分片”:设小=更早分片(慢一点),设大=可能单次溢出(安全回退)。',
				tipSampling: '独立项(不依赖其他项)。原样写入压缩/标题调用的请求体;正常对话不受影响。',
				tipChunkRatio: '依赖「超大对话分片救援」开启。单次内部调用输入预算 = 上下文窗口 × 该比例(其余留给指令、估算误差与输出上限),取值 (0,1]。',
				tipChunkMaxTokens: '依赖「超大对话分片救援」开启。单个分片摘要的输出上限(token)。',
				tipMergeMaxTokens: '依赖「超大对话分片救援」开启。最终合并 checkpoint 的输出上限(token)。',
				tipMaxChunks: '依赖「超大对话分片救援」开启。单次救援的分片数安全上限;超出的区间 fail-open(转发原请求并告警)。',
				tipNewContext: '独立项(不依赖其他项)。语义与 /qwen38-compact 不同:本命令不调用模型、不做摘要——直接把模型可见历史丢弃并写入新窗口标记,秒级完成、零 token 成本。适合任务状态都在文件/git 里的场景;纯问答会话(状态不在环境里)建议用 /qwen38-compact。',
			},
			en: {
				title: 'Qwen3.8 gateway compaction fix',
				description: 'Makes session compaction reliable on local Qwen3.8 gateways (llama.cpp AND NInfer): engine-appropriate thinking-off wire fields + non-thinking sampling for auxiliary calls; oversized conversations compact in chunks. Changes apply live, no restart.',
				scopeNote: 'Scope: every parameter on this page applies ONLY to auxiliary calls — compaction summaries and session titles. Normal conversation is untouched and keeps your gateway defaults (llama.cpp/NInfer).',
				commandHint: 'Manual operations: type /qwen38-compact (model-summarized, keeps information, chunked when oversized) or /qwen38-new-context (hard reset: no LLM call, instant, history discarded) in any session composer. Works even in presets without a built-in compaction engine.',
				basicTitle: 'Basics',
				advancedTitle: 'Advanced (auxiliary calls only)',
				modelsLabel: 'Model ids',
				modelsHint: 'Comma-separated; must exactly match the model ids declared under llm-pi-ai providers in settings.yaml. Empty disables the whole policy.',
				windowsTitle: 'Context window (tokens) — one row per model',
				windowsHint: 'The context window the gateway actually runs for that model (llama.cpp: -c, checkable via curl /v1/models; NInfer: its n_ctx). Only affects WHEN chunking kicks in: smaller = earlier chunking (slower), larger = possible single-call overflow (safe fallback).',
				enableThinkingOffLabel: 'Disable thinking on compaction/title calls',
				enableThinkingOffHint: 'On: writes chat_template_kwargs.enable_thinking=false into matched auxiliary requests (the primary Qwen3 switch on llama.cpp; skipped automatically for NInfer models, which only get reasoning_effort). Normal conversation is unaffected.',
				wireReasoningLabel: 'reasoning_effort field value',
				wireReasoningHint: 'Belt-and-braces: also written into the request body (llama.cpp accepts none/low/medium/high); blank omits the field.',
				maxTokensFloorLabel: 'max_tokens floor',
				maxTokensFloorHint: 'Raises auxiliary-call max_tokens to at least this value (never lowers) so the client-side context clamp cannot eat the output budget. 0 disables.',
				rescueLabel: 'Oversized-compaction chunked rescue',
				rescueHint: 'On: when a compaction prompt exceeds one call, summarize slices sequentially and merge instead of failing with “cannot compact”.',
				newContextLabel: 'Hard-reset command /qwen38-new-context',
				newContextHint: 'When on, any session can hard-reset its context: no LLM call, instant, history discarded (environment state untouched).',
				temperatureLabel: 'temperature',
				topPLabel: 'top_p',
				topKLabel: 'top_k',
				minPLabel: 'min_p',
				presencePenaltyLabel: 'presence_penalty',
				repetitionPenaltyLabel: 'repetition_penalty',
				chunkRatioLabel: 'chunk input ratio (chunkRatio)',
				chunkMaxTokensLabel: 'per-slice output cap (chunkMaxTokens)',
				mergeMaxTokensLabel: 'merge output cap (mergeMaxTokens)',
				maxChunksLabel: 'max slices (maxChunks)',
				on: 'on',
				off: 'off',
				collapse: 'Collapse',
				expand: 'Expand',
				unsaved: 'Unsaved',
				save: 'Save',
				saving: 'Saving…',
				discard: 'Discard',
				overridden: 'overrides default',
				reset: 'Reset to default',
				invalidNumber: 'Enter a number, or leave blank to use the default.',
				saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
				readOnly: 'This deployment stores settings read-only.',
				unavailable: 'The settings service is unavailable.',
				wireOmit: 'omit field',
				rescueOffNote: 'Depends on “oversized-compaction chunked rescue” being on — it is currently off, so the items above are inert (values kept).',
				tipModels: 'Root switch (everything else depends on it): empty disables the whole plugin policy — no other parameter on this page takes effect. Comma-separated; must exactly match the model ids declared under llm-pi-ai providers in settings.yaml.',
				tipEnableThinkingOff: 'Independent item (no dependencies). On: writes chat_template_kwargs.enable_thinking=false into matched compaction/title requests (the primary Qwen3 switch on llama.cpp). Pairs as belt-and-braces with “reasoning_effort field value” — either can be toggled independently. Normal conversation is unaffected.',
				tipWireReasoning: 'Independent item (no dependencies). Dropdown for the reasoning_effort value written into the request body (llama.cpp accepts none/low/medium/high); “omit field” leaves it out. Pairs as belt-and-braces with “disable thinking on compaction/title calls”.',
				tipMaxTokensFloor: 'Independent item (no dependencies). Raises auxiliary-call max_tokens to at least this value (never lowers) so the client-side context clamp cannot eat the output budget. 0 disables.',
				tipChunkingEnabled: 'Master switch of the chunked-rescue group (5 items depend on it): context windows + chunkRatio/chunkMaxTokens/mergeMaxTokens/maxChunks. When off, those items are greyed out and inert (values kept).',
				tipWindows: 'Depends on ① “oversized-compaction chunked rescue” being on; ② the model id appearing in the model-ids list. The llama-server -c actually running for that model (after changing -c or the GGUF in Unsloth Studio, sync from context_length via curl /v1/models). Only affects WHEN chunking kicks in: smaller = earlier chunking (slower), larger = possible single-call overflow (safe fallback).',
				tipSampling: 'Independent item (no dependencies). Written verbatim into compaction/title request bodies; normal conversation is unaffected.',
				tipChunkRatio: 'Depends on “oversized-compaction chunked rescue” being on. Single-call input budget = context window × this ratio (the rest covers instructions, estimation error and the output cap); range (0,1].',
				tipChunkMaxTokens: 'Depends on “oversized-compaction chunked rescue” being on. Per-slice summary output cap (tokens).',
				tipMergeMaxTokens: 'Depends on “oversized-compaction chunked rescue” being on. Final merged-checkpoint output cap (tokens).',
				tipMaxChunks: 'Depends on “oversized-compaction chunked rescue” being on. Safety cap on slices per rescue; ranges beyond it fail open (forward the original request with a warning).',
				tipNewContext: 'Independent item (no dependencies). Different semantics from /qwen38-compact: this command makes NO LLM call and writes no summary — it discards the model-visible history and installs a fresh-window marker, instantly and at zero token cost. Best when task state lives in files/git; for pure Q&A sessions (state not in the environment) prefer /qwen38-compact.',
			},
		};

		// ------------------------------------------------------------------
		// Field registry. path(value) may depend on the current section value.
		// ------------------------------------------------------------------
		function getAt(obj, path) {
			let cur = obj;
			for (const key of path) {
				if (cur === null || typeof cur !== 'object') return undefined;
				cur = cur[key];
			}
			return cur;
		}

		/** True when the user layer actually defines this path (override badge). */
		function hasAt(obj, path) {
			let cur = obj;
			for (const key of path) {
				if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, key)) return false;
				cur = cur[key];
			}
			return true;
		}

		function modelList(value) {
			const models = value && value.models;
			return Array.isArray(models) ? models.filter((m) => typeof m === 'string' && m.length > 0) : [];
		}

		const numberParse = (text) => {
			const trimmed = text.trim();
			if (trimmed === '') return { kind: 'clear' };
			const parsed = Number(trimmed);
			return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined;
		};

		const FIELDS = [
			{
				id: 'models', path: () => ['models'], labelKey: 'modelsLabel', hintKey: 'modelsHint', tipKey: 'tipModels',
				format: (v) => Array.isArray(v) ? v.join(', ') : (typeof v === 'string' ? v : ''),
				parse: (text) => {
					const items = text.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
					return items.length > 0 ? { kind: 'set', value: items } : { kind: 'clear' };
				},
			},
			{
				id: 'enableThinkingOff', path: () => ['enableThinkingOff'], labelKey: 'enableThinkingOffLabel', hintKey: 'enableThinkingOffHint', tipKey: 'tipEnableThinkingOff', bool: true,
			},
			{
				id: 'wireReasoning', path: () => ['wireReasoning'], labelKey: 'wireReasoningLabel', hintKey: 'wireReasoningHint', tipKey: 'tipWireReasoning',
				enum: ['', 'none', 'low', 'medium', 'high'],
				format: (v) => typeof v === 'string' ? v : '',
				parse: (text) => {
					const trimmed = text.trim();
					return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed };
				},
			},
			{
				id: 'maxTokensFloor', path: () => ['maxTokensFloor'], labelKey: 'maxTokensFloorLabel', hintKey: 'maxTokensFloorHint', tipKey: 'tipMaxTokensFloor', numeric: true,
				format: (v) => typeof v === 'number' ? String(v) : '', parse: numberParse,
			},
			{
				id: 'chunkingEnabled', path: () => ['chunking', 'enabled'], labelKey: 'rescueLabel', hintKey: 'rescueHint', tipKey: 'tipChunkingEnabled', bool: true,
			},
			{
				id: 'newContextEnabled', path: () => ['command', 'newContext', 'enabled'], labelKey: 'newContextLabel', hintKey: 'newContextHint', tipKey: 'tipNewContext', bool: true,
			},
		];

		const ADVANCED_FIELDS = [
			{ id: 'temperature', path: () => ['sampling', 'temperature'], labelKey: 'temperatureLabel', tipKey: 'tipSampling', numeric: true },
			{ id: 'topP', path: () => ['sampling', 'top_p'], labelKey: 'topPLabel', tipKey: 'tipSampling', numeric: true },
			{ id: 'topK', path: () => ['sampling', 'top_k'], labelKey: 'topKLabel', tipKey: 'tipSampling', numeric: true },
			{ id: 'minP', path: () => ['sampling', 'min_p'], labelKey: 'minPLabel', tipKey: 'tipSampling', numeric: true },
			{ id: 'presencePenalty', path: () => ['sampling', 'presence_penalty'], labelKey: 'presencePenaltyLabel', tipKey: 'tipSampling', numeric: true },
			{ id: 'repetitionPenalty', path: () => ['sampling', 'repetition_penalty'], labelKey: 'repetitionPenaltyLabel', tipKey: 'tipSampling', numeric: true },
			{ id: 'chunkRatio', path: () => ['chunking', 'chunkRatio'], labelKey: 'chunkRatioLabel', tipKey: 'tipChunkRatio', numeric: true, rescueDependent: true },
			{ id: 'chunkMaxTokens', path: () => ['chunking', 'chunkMaxTokens'], labelKey: 'chunkMaxTokensLabel', tipKey: 'tipChunkMaxTokens', numeric: true, rescueDependent: true },
			{ id: 'mergeMaxTokens', path: () => ['chunking', 'mergeMaxTokens'], labelKey: 'mergeMaxTokensLabel', tipKey: 'tipMergeMaxTokens', numeric: true, rescueDependent: true },
			{ id: 'maxChunks', path: () => ['chunking', 'maxChunks'], labelKey: 'maxChunksLabel', tipKey: 'tipMaxChunks', numeric: true, rescueDependent: true },
		].map((f) => ({ ...f, format: (v) => typeof v === 'number' ? String(v) : '', parse: numberParse }));

		const ALL_FIELDS = FIELDS.concat(ADVANCED_FIELDS);
		const FIELD_BY_ID = Object.fromEntries(ALL_FIELDS.map((f) => [f.id, f]));

		// ------------------------------------------------------------------
		// Controller: staged form over the bound settings scope.
		// ------------------------------------------------------------------
		class Qwen38CardController {
			constructor(scope) {
				this.scope = scope;
				// fieldId -> { text, clear } — mirrors the built-in CardForm staging model:
				// a plain edit stages {text, clear:false}; resetField stages {text: baseValue,
				// clear:true} so saving emits an unset op (the "overrides default" badge is
				// what users click to drop a stored override).
				this.staged = new Map();
				// modelId -> { text, clear } for the per-model context windows.
				this.stagedWindows = new Map();
				this.saving = false;
				this.failed = false;
				// Disclosure is card-local state (mirrors the built-in plugin cards):
				// which card the user has open is a reading gesture, not persisted.
				this.open = false;
				this.store = createSnapshotStore(this.project());
				scope.subscribe(() => this.publish());
			}

			project() {
				const snap = this.scope.getSnapshot();
				const value = (snap && snap.value) || {};
				const fields = {};
				for (const f of ALL_FIELDS) {
					const path = f.path(value);
					const raw = getAt(value, path);
					const entry = this.staged.get(f.id);
					let text;
					let overridden;
					let invalid = false;
					if (entry === undefined) {
						text = f.bool ? String(Boolean(raw)) : f.format(raw);
						overridden = hasAt(snap.user, path);
					} else {
						text = entry.text;
						const write = entry.clear
							? { kind: 'clear' }
							: f.bool ? { kind: 'set', value: entry.text === 'true' } : f.parse(entry.text);
						overridden = write !== undefined && write.kind === 'set';
						invalid = !entry.clear && write === undefined;
					}
					fields[f.id] = { text, overridden, invalid };
				}
				// Per-model context windows (one row per model id in `models`).
				const models = modelList(value);
				const stagedModels = this.staged.has('models') && !this.staged.get('models').clear
					? this.staged.get('models').text.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
					: models;
				const windows = {};
				for (const model of stagedModels) {
					const path = ['chunking', 'contextWindows', model];
					const raw = getAt(value, path);
					const entry = this.stagedWindows.get(model);
					let text;
					let overridden;
					let invalid = false;
					if (entry === undefined) {
						text = typeof raw === 'number' ? String(raw) : '';
						overridden = hasAt(snap.user, path);
					} else {
						text = entry.text;
						const write = entry.clear ? { kind: 'clear' } : numberParse(entry.text);
						overridden = write !== undefined && write.kind === 'set';
						invalid = !entry.clear && write === undefined;
					}
					windows[model] = { text, overridden, invalid };
				}
			// Rescue master switch (staged value wins): gates the chunking group.
			const ce = this.staged.get('chunkingEnabled');
			const rescueOn = ce === undefined
				? Boolean(getAt(value, ['chunking', 'enabled']))
				: ce.text === 'true';
			return {
				status: snap ? snap.status : 'loading',
				writable: Boolean(snap && snap.writable),
				models: stagedModels,
				fields,
				windows,
				rescueOn,
				open: this.open,
				dirty: this.staged.size > 0 || this.stagedWindows.size > 0,
				saving: this.saving,
				failed: this.failed,
			};
			}

			publish() {
				this.store.set(this.project());
			}

			toggleOpen() {
				this.open = !this.open;
				this.publish();
			}

			edit(id, text) {
				if (!FIELD_BY_ID[id]) return;
				this.staged.set(id, { text, clear: false });
				this.failed = false;
				this.publish();
			}

			resetField(id) {
				const f = FIELD_BY_ID[id];
				if (!f) return;
				const snap = this.scope.getSnapshot();
				const base = getAt((snap && snap.base) || {}, f.path((snap && snap.value) || {}));
				this.staged.set(id, { text: f.bool ? String(Boolean(base)) : f.format(base), clear: true });
				this.failed = false;
				this.publish();
			}

			editWindow(model, text) {
				if (typeof model !== 'string' || model.length === 0) return;
				this.stagedWindows.set(model, { text, clear: false });
				this.failed = false;
				this.publish();
			}

			resetWindow(model) {
				const snap = this.scope.getSnapshot();
				const base = getAt((snap && snap.base) || {}, ['chunking', 'contextWindows', model]);
				this.stagedWindows.set(model, { text: typeof base === 'number' ? String(base) : '', clear: true });
				this.failed = false;
				this.publish();
			}

			discard() {
				this.staged.clear();
				this.stagedWindows.clear();
				this.failed = false;
				this.publish();
			}

			async save() {
				const snap = this.scope.getSnapshot();
				if (!snap || !snap.writable || this.saving) return;
				const value = snap.value || {};
				const ops = [];
				for (const f of ALL_FIELDS) {
					if (!this.staged.has(f.id)) continue;
					const entry = this.staged.get(f.id);
					const write = entry.clear
						? { kind: 'clear' }
						: f.bool ? { kind: 'set', value: entry.text === 'true' } : f.parse(entry.text);
					if (write === undefined) return; // invalid field blocks the save
					const path = f.path(value);
					ops.push(write.kind === 'set' ? { op: 'set', path, value: write.value } : { op: 'unset', path });
				}
				for (const [model, entry] of this.stagedWindows) {
					const write = entry.clear ? { kind: 'clear' } : numberParse(entry.text);
					if (write === undefined) return; // invalid window blocks the save
					const path = ['chunking', 'contextWindows', model];
					ops.push(write.kind === 'set' ? { op: 'set', path, value: write.value } : { op: 'unset', path });
				}
				if (ops.length === 0) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				try {
					await this.scope.mutate(ops, snap.revision);
					// Same gesture as the built-in cards: collapse once the write settled.
					this.open = false;
					this.staged.clear();
					this.stagedWindows.clear();
				} catch (error) {
					this.failed = true;
				} finally {
					this.saving = false;
					this.publish();
				}
			}

			/** The face the slot entry injects into the card component. */
			inject() {
				return {
					hooks: { qwen38Card: this.store },
					edit: (id, text) => this.edit(id, text),
					resetField: (id) => this.resetField(id),
					editWindow: (model, text) => this.editWindow(model, text),
					resetWindow: (model) => this.resetWindow(model),
					save: () => this.save(),
					discard: () => this.discard(),
					toggleOpen: () => this.toggleOpen(),
				};
			}
		}

		// ------------------------------------------------------------------
		// UI atoms (plain React + inline styles; primitives for themed inputs).
		// ------------------------------------------------------------------
		const labelWidth = '230px';
		// Typography and rules follow the settings surface's own tokens (the
		// built-in cards), so nothing here reads as a foreign block: label 13px
		// primary, hints 12px tertiary, hairline separators from --dsw-alias-*.
		const rowStyle = { display: 'flex', alignItems: 'flex-start', gap: '16px', padding: '9px 0', borderBottom: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.14))' };
		const labelStyle = { flexBasis: labelWidth, flexGrow: 0, flexShrink: 0, fontSize: '13px', lineHeight: 1.5, paddingTop: '6px', color: 'var(--dsw-alias-label-primary, inherit)' };
		const controlStyle = { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' };
		const inputRowStyle = { display: 'flex', alignItems: 'center', gap: '8px' };
		const hintStyle = { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,0.85))', lineHeight: 1.5 };
		const badgeStyle = { fontSize: '11.5px', marginLeft: '8px', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--dsw-alias-label-tertiary, inherit)', textDecoration: 'underline dotted' };
		const sectionTitleStyle = { fontSize: '12.5px', fontWeight: 600, margin: '16px 0 4px', color: 'var(--dsw-alias-label-secondary, rgba(128,128,128,0.95))' };
		const scopeBannerStyle = {
			margin: '10px 0 12px', padding: '9px 12px', fontSize: '12px', lineHeight: 1.5,
			borderRadius: '8px', border: '0.5px solid var(--dsw-alias-label-warning, #b45309)',
			color: 'var(--dsw-alias-label-secondary, inherit)',
			background: 'color-mix(in srgb, var(--dsw-alias-label-warning, #f59e0b) 10%, transparent)',
		};
		const commandHintStyle = { margin: '0 0 6px', fontSize: '12px', lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9))' };

		// Plugin-card chrome copied from the built-in plugin cards
		// (ui-settings-plugins/PluginCard.module.css), expressed against the same
		// --dsw-alias-* tokens: a header naming the plugin over its description,
		// 16px radius on a layer-3 surface, and the controls only when open.
		const cardStyle = {
			listStyle: 'none', border: '0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.28))',
			borderRadius: '16px', background: 'var(--dsw-alias-bg-layer-3, transparent)',
			transition: 'border-color .16s, background .16s',
		};
		const cardOpenStyle = Object.assign({}, cardStyle, {
			background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06))',
			borderColor: 'var(--dsw-alias-label-dimmed, rgba(128,128,128,0.45))',
		});
		const cardHeaderStyle = {
			width: '100%', appearance: 'none', border: 0, background: 'none',
			font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer',
			display: 'flex', alignItems: 'center', gap: '12px',
			padding: '14px 16px', borderRadius: '12px',
		};
		const headTextStyle = { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' };
		const cardNameStyle = { fontSize: '15px', fontWeight: 600, lineHeight: 1.4, color: 'var(--dsw-alias-label-primary, inherit)' };
		const cardDescStyle = { fontSize: '13px', lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,0.85))' };
		const chevronStyle = { flex: 'none', color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,0.85))', transition: 'transform .16s' };
		const cardBodyStyle = { borderTop: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.18))', margin: '0 16px', paddingBottom: '8px' };

		/**
		 * Self-explanatory on/off switch (role=switch): a pill with a knob plus
		 * an explicit state word, so the current value never depends on reading
		 * a tiny checkbox.
		 */
		function Switch(props) {
			const on = props.checked;
			const disabled = Boolean(props.disabled);
			return h('button', {
				type: 'button',
				role: 'switch',
				'aria-checked': on ? 'true' : 'false',
				disabled,
				onClick: () => { if (!disabled) props.onChange(!on); },
				style: {
					display: 'inline-flex', alignItems: 'center', gap: '8px',
					border: '1px solid rgba(128,128,128,0.35)', borderRadius: '999px',
					background: on ? 'color-mix(in srgb, #16a34a 18%, transparent)' : 'transparent',
					padding: '4px 12px 4px 6px', cursor: disabled ? 'default' : 'pointer',
					fontSize: '12.5px', color: 'inherit', opacity: disabled ? 0.5 : 1,
				},
			},
				h('span', {
					style: {
						width: '26px', height: '15px', borderRadius: '999px', position: 'relative', flex: '0 0 auto',
						background: on ? '#16a34a' : 'rgba(128,128,128,0.4)', transition: 'background 120ms',
					},
				}, h('span', {
					style: {
						position: 'absolute', top: '1.5px', left: on ? '12.5px' : '1.5px',
						width: '12px', height: '12px', borderRadius: '50%', background: '#fff', transition: 'left 120ms',
					},
				})),
				h('span', null, on ? props.onLabel : props.offLabel),
			);
		}

		function OverrideBadge(props) {
			if (!props.overridden) return null;
			return h('button', { type: 'button', style: badgeStyle, title: props.t('reset'), onClick: props.onClick }, props.t('overridden'));
		}

		/** Label with a hover tooltip (title attribute) stating the field's
		 *  dependencies — “独立项” or which switch gates it. */
		function TipLabel(props) {
			return h('label', {
				style: Object.assign({}, labelStyle, { cursor: 'help' }),
				htmlFor: props.id,
				title: props.field.tipKey ? props.t(props.field.tipKey) : undefined,
			}, props.t(props.field.labelKey));
		}

		function FieldRow(props) {
			const t = props.t;
			const state = props.state || {};
			// A rescue-dependent row is inert (but keeps its value) while the
			// rescue master switch is off.
			const dimmed = Boolean(props.dimmed);
			const disabled = Boolean(props.disabled) || dimmed;
			const rowEl = Object.assign({}, rowStyle, dimmed ? { opacity: 0.45 } : {});
			if (props.field.bool) {
				return h('div', { style: rowEl },
					h(TipLabel, { id: props.id, t, field: props.field }),
					h('div', { style: controlStyle },
						h(Switch, {
							checked: state.text === 'true', disabled,
							onLabel: t('on'), offLabel: t('off'),
							onChange: (next) => props.onEdit(next ? 'true' : 'false'),
						}),
						h('span', { style: hintStyle }, t(props.field.hintKey)),
					),
				);
			}
			const control = props.field.enum ? h('select', {
				id: props.id, value: state.text || '', disabled,
				style: { width: '200px', maxWidth: '100%', padding: '4px 6px' },
				onChange: (e) => props.onEdit(e.target.value),
			}, props.field.enum.map((v) => h('option', { key: v || '__empty', value: v }, v === '' ? t('wireOmit') : v)))
				: h(Input, {
					id: props.id, value: state.text || '', disabled, 'aria-invalid': state.invalid || undefined,
					style: Object.assign({ width: '260px', maxWidth: '100%' }, state.invalid ? { borderColor: '#c0392b' } : {}),
					onChange: (e) => props.onEdit(e.target.value),
				});
			return h('div', { style: rowEl },
				h(TipLabel, { id: props.id, t, field: props.field }),
				h('div', { style: controlStyle },
					h('div', { style: inputRowStyle },
						control,
						h(OverrideBadge, { overridden: state.overridden, t, onClick: () => props.onReset() }),
					),
					props.field.hintKey ? h('span', { style: hintStyle }, t(props.field.hintKey)) : null,
				),
			);
		}

		function WindowRow(props) {
			const t = props.t;
			const state = props.state || {};
			const dimmed = Boolean(props.dimmed);
			const disabled = Boolean(props.disabled) || dimmed;
			return h('div', { style: Object.assign({}, rowStyle, dimmed ? { opacity: 0.45 } : {}) },
				h('label', {
					style: Object.assign({}, labelStyle, { cursor: 'help' }),
					htmlFor: props.id, title: t('tipWindows'),
				}, props.model),
				h('div', { style: controlStyle },
					h('div', { style: inputRowStyle },
						h(Input, {
							id: props.id, value: state.text || '', disabled, 'aria-invalid': state.invalid || undefined, placeholder: '—',
							style: Object.assign({ width: '200px', maxWidth: '100%' }, state.invalid ? { borderColor: '#c0392b' } : {}),
							onChange: (e) => props.onEdit(e.target.value),
						}),
						h(OverrideBadge, { overridden: state.overridden, t, onClick: () => props.onReset() }),
					),
				),
			);
		}

		// Card body: scope banner + manual-command hint + grouped fields + footer.
		function Fields(props) {
			const t = props.t;
			const s = props.useQwen38Card((x) => x);
			const disabled = !s.writable || s.saving;
			return h(React.Fragment, null,
				h('p', { style: scopeBannerStyle }, '⚠️ ', t('scopeNote')),
				h('p', { style: commandHintStyle }, t('commandHint')),
				s.status === 'unavailable' ? h('p', null, t('unavailable')) : null,
				h('h4', { style: sectionTitleStyle }, t('basicTitle')),
				FIELDS.map((f) => h(FieldRow, {
					key: f.id, id: props.idPrefix + '-' + f.id, t, field: f, state: s.fields[f.id],
					disabled,
					onEdit: (text) => props.edit(f.id, text),
					onReset: () => props.resetField(f.id),
				})),
				h('div', { style: rowStyle },
					h('label', {
						style: Object.assign({}, labelStyle, { cursor: 'help' }), title: t('tipWindows'),
					}, t('windowsTitle')),
					h('div', { style: controlStyle },
						s.models.length === 0 ? h('span', { style: hintStyle }, '—') : s.models.map((model) => h(WindowRow, {
							key: model, id: props.idPrefix + '-win-' + model.replace(/[^a-zA-Z0-9_-]/g, '_'), t,
							model, state: s.windows[model], disabled, dimmed: !s.rescueOn,
							onEdit: (text) => props.editWindow(model, text),
							onReset: () => props.resetWindow(model),
						})),
						h('span', { style: hintStyle }, t('windowsHint')),
						!s.rescueOn ? h('span', { style: Object.assign({}, hintStyle, { color: '#b45309' }) }, '⚠️ ' + t('rescueOffNote')) : null,
					),
				),
				h('details', null,
					h('summary', { style: Object.assign({ display: 'block' }, sectionTitleStyle, { cursor: 'pointer' }) }, t('advancedTitle')),
					ADVANCED_FIELDS.map((f) => h(FieldRow, {
						key: f.id, id: props.idPrefix + '-' + f.id, t, field: f, state: s.fields[f.id],
						disabled, dimmed: Boolean(f.rescueDependent) && !s.rescueOn,
						onEdit: (text) => props.edit(f.id, text),
						onReset: () => props.resetField(f.id),
					})),
				),
				h('footer', { style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '12px 0 0' } },
					s.dirty && s.writable ? h(Button, { variant: 'primary', size: 'sm', disabled: s.saving || Object.values(s.fields).some((x) => x.invalid) || Object.values(s.windows).some((x) => x.invalid), onClick: () => props.save() }, s.saving ? t('saving') : t('save')) : null,
					s.dirty && s.writable ? h(Button, { variant: 'ghost', size: 'sm', disabled: s.saving, onClick: () => props.discard() }, t('discard')) : null,
					!s.writable && s.status === 'ready' ? h('span', { style: hintStyle }, t('readOnly')) : null,
					s.failed ? h('span', { style: Object.assign({ fontSize: '12px' }, hintStyle) }, t('saveFailed')) : null,
				),
			);
		}

		function Card(props) {
			const t = props.t;
			const s = props.useQwen38Card((x) => x);
			const open = Boolean(s.open);
			return h('li', { style: open ? cardOpenStyle : cardStyle },
				h('button', {
					type: 'button',
					style: cardHeaderStyle,
					'aria-expanded': open ? 'true' : 'false',
					'aria-label': t(open ? 'collapse' : 'expand') + ': ' + t('title'),
					onClick: () => props.toggleOpen(),
				},
					h('span', { style: headTextStyle },
						h('span', { style: cardNameStyle }, t('title')),
						h('span', { style: cardDescStyle }, t('description')),
					),
					s.dirty ? h(Tag, { tone: 'neutral' }, t('unsaved')) : null,
					h(IconChevronDownOutline14, {
						style: open ? Object.assign({}, chevronStyle, { transform: 'rotate(180deg)' }) : chevronStyle,
					}),
				),
				open
					? h('div', { style: cardBodyStyle },
						h(Fields, Object.assign({ idPrefix: 'plugin-config-qwen38' }, props)),
					)
					: null,
			);
		}

		// ------------------------------------------------------------------
		// Cordis client plugin surface.
		// ------------------------------------------------------------------
		exports.name = NS;
		exports.inject = ['slots', 'locale', 'settingsScope'];

		/**
		 * Register the locale dictionaries and the settings views.
		 * @param ctx - the browser Cordis context.
		 */
		exports.apply = function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, LOCALES), NS + ': client dictionaries');
			const t = typeof ctx.locale?.bind === 'function' ? ctx.locale.bind(NS) : (key) => String(key);
			const controller = new Qwen38CardController(ctx.settingsScope.bind({ namespace: NS }));
			// The one home for a plugin's settings — Settings → 插件 → 插件配置 —
			// matching every built-in plugin (no separate left-nav entry).
			ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
				name: 'settings.plugin.item',
				key: NS,
				locale: NS,
				inject: () => controller.inject(),
			}, Card));
		};

		return module.exports;
	}
});
