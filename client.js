/**
 * dsh-qwen38-llamacpp-compaction-fix — browser half (self-contained client bundle).
 *
 * Hand-written on purpose: the dsh web shell serves this file verbatim into the
 * page module table (package.json `dsh.client` + `./client` export), so it must
 * be a standalone script that registers one lazy factory through
 * `window.__ModuleLoader__.load`. No build step, no imports beyond the client
 * baseline (react, dsh-client-ui-primitives, dsh-client-store).
 *
 * What it renders: one card in Settings → Plugins → Plugin configuration for
 * the `qwen38-llamacpp-compaction-fix` settings namespace. The tab pairs slot
 * entries with served namespaces by key; this entry claims that key.
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
				description: '压缩摘要与会话标题等辅助调用关闭思考、改写采样参数;超大对话自动分片压缩(1M→250k 模型切换场景)。保存后实时生效,无需重启。',
				modelsLabel: '适用模型 ID',
				modelsHint: '逗号分隔,须与 settings.yaml 中 llm-pi-ai providers 声明的模型 id 完全一致;留空则整个策略停用。',
				contextWindowLabel: '上下文窗口(tokens)',
				contextWindowHint: '当前模型的 llama-server 实际 n_ctx(查 GET /v1/models → details.n_ctx)。未列出的模型永不分片,按单次调用处理。',
				enableThinkingOffLabel: '压缩/标题调用关闭思考',
				enableThinkingOffHint: '向匹配的请求体写入 chat_template_kwargs.enable_thinking=false(Qwen3 在 llama.cpp 上的主开关)。',
				wireReasoningLabel: 'reasoning_effort 字段值',
				wireReasoningHint: '同时写入请求体的 reasoning_effort(双保险);留空表示不写该字段。llama.cpp 接受 none/low/medium/high。',
				maxTokensFloorLabel: 'max_tokens 下限',
				maxTokensFloorHint: '压缩请求的 max_tokens 至少抬到该值(只升不降),防止客户端上下文钳制吃掉输出预算;0 停用。',
				rescueLabel: '超大对话分片救援',
				rescueHint: '压缩提示词超过单次调用容量时,自动切分逐段摘要再合并,而不是报“无法压缩”。',
				advancedTitle: '高级参数(采样与分片调优)',
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
				description: 'Thinking off + sampling rewrite for auxiliary calls (compaction / session title); oversized conversations are compacted in chunks (1M→250k model switch). Changes apply live, no restart.',
				modelsLabel: 'Model ids',
				modelsHint: 'Comma-separated; must exactly match the model ids declared under llm-pi-ai providers in settings.yaml. Empty disables the whole policy.',
				contextWindowLabel: 'Context window (tokens)',
				contextWindowHint: 'The llama-server n_ctx actually running for this model (GET /v1/models → details.n_ctx). Unlisted models are never chunked.',
				enableThinkingOffLabel: 'Disable thinking on compaction/title calls',
				enableThinkingOffHint: 'Writes chat_template_kwargs.enable_thinking=false into matched request bodies (the primary Qwen3 switch on llama.cpp).',
				wireReasoningLabel: 'reasoning_effort field value',
				wireReasoningHint: 'Also written into matched bodies as a second gate; blank omits the field. llama.cpp accepts none/low/medium/high.',
				maxTokensFloorLabel: 'max_tokens floor',
				maxTokensFloorHint: 'Raises compaction max_tokens to at least this value (never lowers) so the client-side context clamp cannot eat the output budget. 0 disables.',
				rescueLabel: 'Oversized-compaction chunked rescue',
				rescueHint: 'When a compaction prompt exceeds one call, summarize slices sequentially and merge instead of failing with "cannot compact".',
				advancedTitle: 'Advanced (sampling & chunk tuning)',
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
		// Field registry. path(value) may depend on the current section value
		// (the context-window entry is keyed by the first model id).
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

		function firstModel(value) {
			const models = value && value.models;
			return Array.isArray(models) && typeof models[0] === 'string' ? models[0] : '';
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
				id: 'contextWindow', path: (v) => ['chunking', 'contextWindows', firstModel(v)], labelKey: 'contextWindowLabel', hintKey: 'contextWindowHint', numeric: true,
				format: (v) => typeof v === 'number' ? String(v) : '', parse: numberParse,
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
				return {
					status: snap ? snap.status : 'loading',
					writable: Boolean(snap && snap.writable),
					model: firstModel(value),
					fields,
					dirty: this.staged.size > 0,
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

			discard() {
				this.staged.clear();
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
				if (ops.length === 0) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				try {
					await this.scope.mutate(ops, snap.revision);
					this.staged.clear();
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
					save: () => this.save(),
					discard: () => this.discard(),
				};
			}
		}

		// ------------------------------------------------------------------
		// Card UI (plain React; primitives for the themed atoms).
		// ------------------------------------------------------------------
		const rowStyle = { display: 'flex', alignItems: 'baseline', gap: '12px', padding: '6px 0' };
		const labelStyle = { flex: '0 0 40%', fontSize: '13px', opacity: 0.9 };
		const controlStyle = { flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: '2px' };
		const hintStyle = { fontSize: '11px', opacity: 0.55, lineHeight: 1.4 };
		const badgeStyle = { fontSize: '11px', opacity: 0.6, marginLeft: '8px' };

		function FieldRow(props) {
			const t = props.t;
			const state = props.state;
			if (props.field.bool) {
				return h('div', { style: rowStyle },
					h('label', { style: labelStyle, htmlFor: props.id }, t(props.field.labelKey)),
					h('div', { style: controlStyle },
						h('input', {
							id: props.id, type: 'checkbox', checked: state.text === 'true', disabled: props.disabled,
							onChange: (e) => props.onEdit(e.target.checked ? 'true' : 'false'),
						}),
						h('span', { style: hintStyle }, t(props.field.hintKey)),
					),
				);
			}
			return h('div', { style: rowStyle },
				h('label', { style: labelStyle, htmlFor: props.id }, t(props.field.labelKey)),
				h('div', { style: controlStyle },
					h(Input, {
						id: props.id, value: state.text, disabled: props.disabled, 'aria-invalid': state.invalid || undefined,
						style: state.invalid ? { borderColor: '#c0392b' } : undefined,
						onChange: (e) => props.onEdit(e.target.value),
					}),
					h('span', { style: hintStyle }, t(props.field.hintKey)),
				),
				state.overridden
					? h('button', {
						type: 'button', style: Object.assign({ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit' }, badgeStyle),
						title: t('reset'), onClick: () => props.onReset(),
					}, t('overridden'))
					: null,
			);
		}

		function Card(props) {
			const t = props.t;
			const s = props.useQwen38Card((x) => x);
			const disabled = !s.writable || s.saving;
			return h('section', { 'aria-label': t('title') },
				h('header', null,
					h('h3', null, t('title')),
					h('p', { style: hintStyle }, t('description')),
				),
				s.status === 'unavailable' ? h('p', null, t('unavailable')) : null,
				FIELDS.map((f) => h(FieldRow, {
					key: f.id, id: 'plugin-config-qwen38-' + f.id, t, field: f, state: s.fields[f.id],
					disabled: disabled || (f.id === 'contextWindow' && s.model === ''),
					onEdit: (text) => props.edit(f.id, text),
					onReset: () => props.resetField(f.id),
				})),
				h('details', null,
					h('summary', { style: { fontSize: '13px', padding: '8px 0', cursor: 'pointer' } }, t('advancedTitle')),
					ADVANCED_FIELDS.map((f) => h(FieldRow, {
						key: f.id, id: 'plugin-config-qwen38-' + f.id, t, field: f, state: s.fields[f.id],
						disabled: disabled,
						onEdit: (text) => props.edit(f.id, text),
						onReset: () => props.resetField(f.id),
					})),
				),
				h('footer', { style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 0' } },
					s.dirty && s.writable ? h(Button, { variant: 'primary', size: 'sm', disabled: s.saving || Object.values(s.fields).some((x) => x.invalid), onClick: () => props.save() }, s.saving ? t('saving') : t('save')) : null,
					s.dirty && s.writable ? h(Button, { variant: 'ghost', size: 'sm', disabled: s.saving, onClick: () => props.discard() }, t('discard')) : null,
					!s.writable && s.status === 'ready' ? h('span', { style: hintStyle }, t('readOnly')) : null,
					s.failed ? h('span', { style: Object.assign({ fontSize: '12px' }, hintStyle) }, t('saveFailed')) : null,
				),
			);
		}

		// ------------------------------------------------------------------
		// Cordis client plugin surface.
		// ------------------------------------------------------------------
		exports.name = NS;
		exports.inject = ['slots', 'locale', 'settingsScope'];

		/**
		 * Register the locale dictionaries and the settings card.
		 * @param ctx - the browser Cordis context.
		 */
		exports.apply = function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, LOCALES), NS + ': client dictionaries');
			const controller = new Qwen38CardController(ctx.settingsScope.bind({ namespace: NS }));
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
