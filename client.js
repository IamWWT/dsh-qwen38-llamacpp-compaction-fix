/**
 * dsh-qwen38-llamacpp-compaction-fix — browser half (self-contained client bundle).
 *
 * Hand-written on purpose: the dsh web shell serves this file verbatim into the
 * page module table (package.json `dsh.client` + `./client` export), so it must
 * be a standalone script that registers one lazy factory through
 * `window.__ModuleLoader__.load`. No build step, no imports beyond the client
 * baseline (react, dsh-client-ui-primitives, dsh-client-store).
 *
 * What it renders:
 *   - a dedicated left-nav settings section (Settings → “Qwen3.8 压缩修复”);
 *   - the same card inside Settings → Plugins → Plugin configuration.
 * Both views edit the one `qwen38-llamacpp-compaction-fix` settings namespace.
 */
window.__ModuleLoader__.load({
	id: 'dsh-qwen38-llamacpp-compaction-fix',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require('react');
		const h = React.createElement;
		const { Button, Input } = require('@deepseek-ai/dsh-client-ui-primitives');
		const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store');

		/** Settings namespace this card edits (must match the Host half). */
		const NS = 'qwen38-llamacpp-compaction-fix';

		// ------------------------------------------------------------------
		// Locale dictionaries (flat key -> string, zh primary / en fallback).
		// ------------------------------------------------------------------
		const LOCALES = {
			zh: {
				title: 'Qwen3.8 llama.cpp 压缩修复',
				nav: 'Qwen3.8 压缩修复',
				description: '让本地 llama.cpp(Qwen3.8)上的会话压缩可靠完成:辅助调用关闭思考、使用非思考模式推荐采样参数;超大对话自动分片压缩。保存后实时生效,无需重启。',
				scopeNote: '作用域:本页全部参数只作用于「压缩摘要」与「会话标题」两类辅助调用。正常对话完全不受影响,仍使用你 llama.cpp 服务端的参数(temp、top_p、惩罚项、思考模式等)。',
				commandHint: '手动压缩:在任意会话输入框输入 /qwen38-compact,立即把该会话历史压缩成摘要检查点(极简模式等无内置压缩引擎的会话也可用;超窗历史自动分片)。',
				basicTitle: '基础设置',
				advancedTitle: '高级参数(仅作用于压缩/标题调用)',
				modelsLabel: '适用模型 ID',
				modelsHint: '逗号分隔,须与 settings.yaml 中 llm-pi-ai providers 声明的模型 id 完全一致;留空则整个策略停用。',
				windowsTitle: '上下文窗口(tokens)——每个模型一行',
				windowsHint: '该模型 llama-server 实际运行的 -c(Unsloth Studio 改过 -c 或换 GGUF 后,用 curl /v1/models 查 context_length 并同步到这里)。只影响“何时分片”:设小=更早分片(慢一点),设大=可能单次溢出(安全回退)。',
				enableThinkingOffLabel: '压缩/标题调用关闭思考',
				enableThinkingOffHint: '开启:向匹配的辅助请求写入 chat_template_kwargs.enable_thinking=false(Qwen3 在 llama.cpp 上的主开关)。正常对话不受影响。',
				wireReasoningLabel: 'reasoning_effort 字段值',
				wireReasoningHint: '双保险:同时写入请求体的 reasoning_effort(llama.cpp 接受 none/low/medium/high);留空表示不写该字段。',
				maxTokensFloorLabel: 'max_tokens 下限',
				maxTokensFloorHint: '辅助调用的 max_tokens 至少抬到该值(只升不降),防止客户端上下文钳制吃掉输出预算;0 停用。',
				rescueLabel: '超大对话分片救援',
				rescueHint: '开启:压缩提示词超过单次调用容量时,自动切分逐段摘要再合并,而不是报“无法压缩”。',
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
				save: '保存',
				saving: '保存中…',
				discard: '放弃修改',
				overridden: '已覆盖默认值',
				reset: '恢复默认',
				invalidNumber: '请输入数字,或留空使用默认值。',
				saveFailed: '部署未接受这些值,改动仍保留在表单中,请修正后重试。',
				readOnly: '当前部署的设置存储为只读。',
				unavailable: '设置服务暂不可用。',
			},
			en: {
				title: 'Qwen3.8 llama.cpp compaction fix',
				nav: 'Qwen3.8 compaction fix',
				description: 'Makes session compaction reliable on local llama.cpp (Qwen3.8): thinking off + non-thinking sampling for auxiliary calls; oversized conversations compact in chunks. Changes apply live, no restart.',
				scopeNote: 'Scope: every parameter on this page applies ONLY to auxiliary calls — compaction summaries and session titles. Normal conversation is untouched and keeps your llama.cpp server parameters (temp, top_p, penalties, thinking mode).',
				commandHint: 'Manual compaction: type /qwen38-compact in any session composer to compact that session’s history into a summary checkpoint right now (works even in presets without a built-in compaction engine; oversized history is chunked automatically).',
				basicTitle: 'Basics',
				advancedTitle: 'Advanced (auxiliary calls only)',
				modelsLabel: 'Model ids',
				modelsHint: 'Comma-separated; must exactly match the model ids declared under llm-pi-ai providers in settings.yaml. Empty disables the whole policy.',
				windowsTitle: 'Context window (tokens) — one row per model',
				windowsHint: 'The llama-server -c actually running for that model (after changing -c or the GGUF in Unsloth Studio, check context_length via curl /v1/models and sync it here). Only affects WHEN chunking kicks in: smaller = earlier chunking (slower), larger = possible single-call overflow (safe fallback).',
				enableThinkingOffLabel: 'Disable thinking on compaction/title calls',
				enableThinkingOffHint: 'On: writes chat_template_kwargs.enable_thinking=false into matched auxiliary requests (the primary Qwen3 switch on llama.cpp). Normal conversation is unaffected.',
				wireReasoningLabel: 'reasoning_effort field value',
				wireReasoningHint: 'Belt-and-braces: also written into the request body (llama.cpp accepts none/low/medium/high); blank omits the field.',
				maxTokensFloorLabel: 'max_tokens floor',
				maxTokensFloorHint: 'Raises auxiliary-call max_tokens to at least this value (never lowers) so the client-side context clamp cannot eat the output budget. 0 disables.',
				rescueLabel: 'Oversized-compaction chunked rescue',
				rescueHint: 'On: when a compaction prompt exceeds one call, summarize slices sequentially and merge instead of failing with “cannot compact”.',
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
				save: 'Save',
				saving: 'Saving…',
				discard: 'Discard',
				overridden: 'overrides default',
				reset: 'Reset to default',
				invalidNumber: 'Enter a number, or leave blank to use the default.',
				saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
				readOnly: 'This deployment stores settings read-only.',
				unavailable: 'The settings service is unavailable.',
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
				id: 'models', path: () => ['models'], labelKey: 'modelsLabel', hintKey: 'modelsHint',
				format: (v) => Array.isArray(v) ? v.join(', ') : (typeof v === 'string' ? v : ''),
				parse: (text) => {
					const items = text.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
					return items.length > 0 ? { kind: 'set', value: items } : { kind: 'clear' };
				},
			},
			{
				id: 'enableThinkingOff', path: () => ['enableThinkingOff'], labelKey: 'enableThinkingOffLabel', hintKey: 'enableThinkingOffHint', bool: true,
			},
			{
				id: 'wireReasoning', path: () => ['wireReasoning'], labelKey: 'wireReasoningLabel', hintKey: 'wireReasoningHint',
				format: (v) => typeof v === 'string' ? v : '',
				parse: (text) => {
					const trimmed = text.trim();
					return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed };
				},
			},
			{
				id: 'maxTokensFloor', path: () => ['maxTokensFloor'], labelKey: 'maxTokensFloorLabel', hintKey: 'maxTokensFloorHint', numeric: true,
				format: (v) => typeof v === 'number' ? String(v) : '', parse: numberParse,
			},
			{
				id: 'chunkingEnabled', path: () => ['chunking', 'enabled'], labelKey: 'rescueLabel', hintKey: 'rescueHint', bool: true,
			},
		];

		const ADVANCED_FIELDS = [
			{ id: 'temperature', path: () => ['sampling', 'temperature'], labelKey: 'temperatureLabel', numeric: true },
			{ id: 'topP', path: () => ['sampling', 'top_p'], labelKey: 'topPLabel', numeric: true },
			{ id: 'topK', path: () => ['sampling', 'top_k'], labelKey: 'topKLabel', numeric: true },
			{ id: 'minP', path: () => ['sampling', 'min_p'], labelKey: 'minPLabel', numeric: true },
			{ id: 'presencePenalty', path: () => ['sampling', 'presence_penalty'], labelKey: 'presencePenaltyLabel', numeric: true },
			{ id: 'repetitionPenalty', path: () => ['sampling', 'repetition_penalty'], labelKey: 'repetitionPenaltyLabel', numeric: true },
			{ id: 'chunkRatio', path: () => ['chunking', 'chunkRatio'], labelKey: 'chunkRatioLabel', numeric: true },
			{ id: 'chunkMaxTokens', path: () => ['chunking', 'chunkMaxTokens'], labelKey: 'chunkMaxTokensLabel', numeric: true },
			{ id: 'mergeMaxTokens', path: () => ['chunking', 'mergeMaxTokens'], labelKey: 'mergeMaxTokensLabel', numeric: true },
			{ id: 'maxChunks', path: () => ['chunking', 'maxChunks'], labelKey: 'maxChunksLabel', numeric: true },
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
				return {
					status: snap ? snap.status : 'loading',
					writable: Boolean(snap && snap.writable),
					models: stagedModels,
					fields,
					windows,
					dirty: this.staged.size > 0 || this.stagedWindows.size > 0,
					saving: this.saving,
					failed: this.failed,
				};
			}

			publish() {
				this.store.set(this.project());
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
				};
			}
		}

		// ------------------------------------------------------------------
		// UI atoms (plain React + inline styles; primitives for themed inputs).
		// ------------------------------------------------------------------
		const labelWidth = '230px';
		const rowStyle = { display: 'flex', alignItems: 'flex-start', gap: '16px', padding: '9px 0', borderBottom: '1px solid rgba(128,128,128,0.12)' };
		const labelStyle = { flexBasis: labelWidth, flexGrow: 0, flexShrink: 0, fontSize: '13px', paddingTop: '6px' };
		const controlStyle = { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' };
		const inputRowStyle = { display: 'flex', alignItems: 'center', gap: '8px' };
		const hintStyle = { fontSize: '11.5px', opacity: 0.6, lineHeight: 1.45 };
		const badgeStyle = { fontSize: '11px', opacity: 0.65, marginLeft: '8px', border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', textDecoration: 'underline dotted' };
		const sectionTitleStyle = { fontSize: '13px', fontWeight: 600, margin: '18px 0 4px', opacity: 0.85 };
		const scopeBannerStyle = {
			margin: '10px 0 12px', padding: '9px 12px', fontSize: '12.5px', lineHeight: 1.5,
			borderRadius: '6px', border: '1px solid #b45309',
			background: 'color-mix(in srgb, #f59e0b 12%, transparent)',
		};
		const commandHintStyle = { margin: '0 0 6px', fontSize: '12.5px', lineHeight: 1.5, opacity: 0.75 };

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

		function FieldRow(props) {
			const t = props.t;
			const state = props.state || {};
			const disabled = Boolean(props.disabled);
			if (props.field.bool) {
				return h('div', { style: rowStyle },
					h('label', { style: labelStyle, htmlFor: props.id }, t(props.field.labelKey)),
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
			return h('div', { style: rowStyle },
				h('label', { style: labelStyle, htmlFor: props.id }, t(props.field.labelKey)),
				h('div', { style: controlStyle },
					h('div', { style: inputRowStyle },
						h(Input, {
							id: props.id, value: state.text || '', disabled, 'aria-invalid': state.invalid || undefined,
							style: Object.assign({ width: '260px', maxWidth: '100%' }, state.invalid ? { borderColor: '#c0392b' } : {}),
							onChange: (e) => props.onEdit(e.target.value),
						}),
						h(OverrideBadge, { overridden: state.overridden, t, onClick: () => props.onReset() }),
					),
					props.field.hintKey ? h('span', { style: hintStyle }, t(props.field.hintKey)) : null,
				),
			);
		}

		function WindowRow(props) {
			const t = props.t;
			const state = props.state || {};
			const disabled = Boolean(props.disabled);
			return h('div', { style: rowStyle },
				h('label', { style: labelStyle, htmlFor: props.id }, props.model),
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

		// Shared field body (used by both the plugins-tab card and the dedicated
		// settings section): scope banner + grouped fields + action footer.
		function Fields(props) {
			const t = props.t;
			const s = props.useQwen38Card((x) => x);
			const disabled = !s.writable || s.saving;
			return h(React.Fragment, null,
				h('p', { style: scopeBannerStyle }, '⚠️ ', t('scopeNote')),
				s.status === 'unavailable' ? h('p', null, t('unavailable')) : null,
				h('h4', { style: sectionTitleStyle }, t('basicTitle')),
				FIELDS.map((f) => h(FieldRow, {
					key: f.id, id: props.idPrefix + '-' + f.id, t, field: f, state: s.fields[f.id],
					disabled,
					onEdit: (text) => props.edit(f.id, text),
					onReset: () => props.resetField(f.id),
				})),
				h('div', { style: rowStyle },
					h('label', { style: labelStyle }, t('windowsTitle')),
					h('div', { style: controlStyle },
						s.models.length === 0 ? h('span', { style: hintStyle }, '—') : s.models.map((model) => h(WindowRow, {
							key: model, id: props.idPrefix + '-win-' + model.replace(/[^a-zA-Z0-9_-]/g, '_'), t,
							model, state: s.windows[model], disabled,
							onEdit: (text) => props.editWindow(model, text),
							onReset: () => props.resetWindow(model),
						})),
						h('span', { style: hintStyle }, t('windowsHint')),
					),
				),
				h('details', null,
					h('summary', { style: Object.assign({ display: 'block' }, sectionTitleStyle, { cursor: 'pointer' }) }, t('advancedTitle')),
					ADVANCED_FIELDS.map((f) => h(FieldRow, {
						key: f.id, id: props.idPrefix + '-' + f.id, t, field: f, state: s.fields[f.id],
						disabled,
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
			return h('section', { 'aria-label': t('title') },
				h('header', null,
					h('h3', null, t('title')),
					h('p', { style: hintStyle }, t('description')),
				),
				h(Fields, Object.assign({ idPrefix: 'plugin-config-qwen38' }, props)),
			);
		}

		// Dedicated left-nav settings section (Settings → “Qwen3.8 压缩修复”).
		function Qwen38Section(props) {
			const t = props.t;
			return h('div', null,
				h('h2', null, t('title')),
				h('p', { style: hintStyle }, t('description')),
				h('p', { style: commandHintStyle }, t('commandHint')),
				h(Fields, Object.assign({ idPrefix: 'qwen38-section' }, props)),
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
			// Existing location: the plugins-tab card (Settings → 插件 → 插件配置).
			ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
				name: 'settings.plugin.item',
				key: NS,
				locale: NS,
				inject: () => controller.inject(),
			}, Card));
			// Dedicated left-nav section (Settings → “Qwen3.8 压缩修复”): the same
			// live scope, plus the scope banner and the /qwen38-compact hint.
			ctx.slots.inject('settings.section', () => ctx.slots.register({
				name: 'settings.section',
				id: 'qwen38-compaction',
				order: 20,
				label: () => t('nav'),
				locale: NS,
				inject: () => controller.inject(),
			}, Qwen38Section));
		};

		return module.exports;
	}
});
