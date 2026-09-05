# Changelog

## 0.2.0 (2026-09-05)

### Added

- **Web settings card** (browser half): the plugin now ships a self-contained
  client bundle (`client.js`, no build step) declared through `package.json`
  `dsh.client` + the `./client` export. In dsh web it renders as the
  “Qwen3.8 llama.cpp 压缩修复” card under Settings → Plugins → Plugin
  configuration, editing every config key (model ids, context window,
  thinking-off / wire-reasoning toggles, max_tokens floor, rescue switch,
  and an advanced section with all sampling + chunk tuning fields). Saving
  writes `settings.yaml` live; the “overrides default” badge stages a
  reset-to-default (unset) op on save — same staging model as the built-in
  cards. Chinese + English locale.
- `test/client-smoke.mjs`: loads the client bundle in a VM with a stubbed
  module loader, drives the Cordis surface (locale registration, slot
  entry), renders the card through a minimal React renderer, and exercises
  edit / save / invalid-block / reset-unset / discard against a fake
  settings scope.
- README: web-card usage section plus a troubleshooting section for
  already-stuck conversations (minimal preset ships no compaction engine;
  pi-ai rejects any `reasoningEffort` — including `off` — for models that
  declare no reasoning capability, which is why this plugin's effort layer
  stays silent for undeclared models and relies on the wire layers).

### Verified end-to-end (real dsh web instance + headless Chrome via CDP)

- card renders with live values from the real settings scope;
- UI edit → save writes `settings.yaml` (`maxTokensFloor: 16000` observed on
  disk); badge → save removes the key again (unset path), leaving no residue.

## 0.1.1 (2026-09-05)

### Fixed

- **Boot failure on source builds**: `@deepseek-ai/dsh-settings` has two API
generations — npm releases (0.1.1-rc.x) export the free functions
  `installSettingsSection`/`settingsNamespace`, while newer source-tree
  releases (>= 0.1.3) expose `ctx.settings.installSection(...)` on the service
  and export no free functions. The static named import crashed plugin loading
  in source builds ("does not provide an export named
  'installSettingsSection'"). The module now imports dsh-settings dynamically
  and supports both generations: new API via the optional
  `ctx.inject(["settings"], cb)` scope, legacy free function as fallback,
  schema-resolved composition entry as the final fallback (no settings service
  mounted). Works unchanged in npm and source builds.
- Test coverage for both settings API generations added to `test/smoke.mjs`
  (41 cases total).

## 0.1.0 (2026-09-05)

Initial release. Local plugin for llama.cpp gateways (tuned on Unsloth Studio +
Qwen3.8-27B GGUF, llama.cpp build 10798).

### R1 — thinking off for auxiliary calls only

- `llm/stream` waterfall layer: stamps `reasoningEffort: "off"` on calls whose
  `purpose` is in `purposes` and whose `options.model` is in `models`; resolves
  the model's offered efforts with preference order configured → `off` → `low`.
- HTTP compaction-body layer: process-global `fetch` wrapper writes, on bodies
  carrying the dsh-compaction-basic instruction signature for an allowed model:
  - `chat_template_kwargs.enable_thinking = false` (merged; other template kwargs preserved),
  - `reasoning_effort` set to the configured wire value (default `"none"`),
  - the configured non-thinking sampling entries (`temperature/top_p/top_k/min_p/presence_penalty/repetition_penalty`, default Qwen3's recommended non-thinking set),
  - a raise-only `max_tokens`/`max_completion_tokens` floor (default 16384) restoring the output budget when pi-ai's client-side context clamp collapses it.
- HTTP session-title layer: same two thinking-off wire fields on bodies carrying
  the dsh-session-title-llm system-prompt signature for an allowed model; the
  title plugin's own `max_tokens` is left untouched.
- Model allow-list (`models`, default `["Qwen3.8-27B-GGUF"]`) enforced at every
  layer; empty list disables the whole policy. Signature gates use structural
  prefix matches (compaction instruction must start the final user message; the
  title prompt must start a system/developer message), so conversation turns
  that merely quote either signature pass through untouched.
- Settings section `qwen38-llamacpp-compaction-fix:` in `$DSH_HOME/settings.yaml`
  overrides the bundle config live, without a restart.

### R2 — oversized-conversation compaction rescue (chunked map-reduce)

Fixes the "chatted on a 1M-context model, switched to a 250k-context local
model, now 'cannot compact'" case: dsh-compaction-basic's single-shot
summarization cannot fit a conversation larger than the target window.

- HTTP rescue layer: after the compaction-body rewrite, estimates the prompt
  tokens (CJK-conservative heuristic: ~1 token/CJK char, chars/4 otherwise,
  1024 per image block, `tools` schemas included). When it exceeds
  `chunkRatio × contextWindows[model]` and chunking is enabled for that model,
  the original request is NOT forwarded; instead:
  - the message range is split into consecutive slices (leading system/developer
    messages re-sent per slice and charged to the budget; a `tool`-role message
    never starts a slice; an over-budget single message is head/tail-truncated
    for internal calls only — the durable surface is untouched);
  - each slice is summarized sequentially (non-streaming, thinking off, sampling
    applied, `max_tokens = chunkMaxTokens`, the conversation's own compaction
    instruction appended verbatim);
  - partial checkpoints are merged in a final call (`mergeMaxTokens`), with an
    automatic two-level hierarchical merge when even the flat merge would not fit;
  - the merged checkpoint is returned to dsh as a standard OpenAI response: SSE
    stream with keep-alive pings (15s) when the original request was streaming,
    plain JSON otherwise.
- Fail-open semantics everywhere: unknown model window / more slices than
  `maxChunks` / unparseable body → forward the original untouched; mid-flight
  failure (after one retry per call) → stream ends with EMPTY content, which
  dsh-compaction-basic rejects cleanly and the conversation surface is preserved
  — the same safe outcome as today's overflow.

### Verification

- `test/smoke.mjs`: 37 gating/estimation/slicing/body-shaping cases pass.
- `test/rescue-e2e.mjs`: 29 end-to-end cases with a mock transport pass (slice
  fan-out, merge call, thinking-off carry-over, tools dropped, SSE shape).
- Live gateway checks (llama.cpp build 10798 via Unsloth Studio :8880): default
  requests think (non-empty `reasoning_content`); both
  `chat_template_kwargs.enable_thinking=false` and `reasoning_effort="none"`
  independently suppress thinking (streaming and non-streaming, easy and hard
  prompts); all six sampling fields are accepted without error.
