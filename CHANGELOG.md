# Changelog

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
