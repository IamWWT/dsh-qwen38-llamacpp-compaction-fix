# Qwen3.8 Gateway Compaction & Context Management (DSH plugin)

`dsh-qwen38-gateway-compaction` is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin for local Qwen3.8 gateways, covering **llama.cpp / Unsloth Studio** and **NInfer**.

GitHub renders the Chinese [`README.md`](./README.md) by default. This English file is `README.en.md`.

## Capability matrix

| Capability | Status | Scope |
|---|---|---|
| Thinking-off for compaction calls | Implemented | Only matched models; normal conversation untouched |
| Thinking-off for session-title calls | Implemented | Prevents short title budgets being consumed by reasoning |
| llama.cpp / NInfer wire-field split | Implemented | NInfer never receives the unsupported `chat_template_kwargs` |
| Compaction sampling + `max_tokens` floor | Implemented | Prevents client-side clamp from collapsing the summary budget |
| Oversized-conversation chunked map-reduce rescue | Implemented | Handles compaction overflow after switching to a smaller-window model |
| `/qwen38-compact` | Implemented | Manual model-summarized checkpoint |
| `/qwen38-new-context` | Implemented | Manual zero-LLM hard reset to a fresh context window |
| minimal-preset 80% warning / 98% auto-compact | Design fixed, pending implementation | Only applies to the `minimal` preset; see below |

## Server-side hard limit

The plugin's context budget must agree with the NInfer server's hard limit. The target server is configured as:

```text
contextWindow:      378144 tokens
defaultMaxOutput:   192000 tokens
safety margin:      ceil(378144 × 5%) = 18908 tokens
max input:          378144 - 192000 - 18908 = 167236 tokens
```

Requests whose input exceeds `167236` tokens are rejected by NInfer immediately:

```text
context_length_exceeded
```

The request never enters GPU prefill and never reaches generation. The client therefore cannot wait for a server error; it must compute context pressure against the same budget before sending a request.

## minimal-preset context policy

The `minimal` preset does not assemble DSH's official `compaction-basic` auto-compaction engine. The plugin plans to add a minimal-only policy without modifying DSH source:

```text
usableInputBudget = contextWindow
                   - maxOutputTokens
                   - ceil(contextWindow × safetyMarginRatio)

warningTokens      = floor(usableInputBudget × warningRatio)
autoCompactTokens  = ceil(usableInputBudget × autoCompactRatio)
```

Defaults:

```text
contextWindow      = 378144
maxOutputTokens    = 192000
safetyMarginRatio  = 0.05
usableInputBudget  = 167236
warningRatio       = 0.80
autoCompactRatio   = 0.98
```

Result:

```text
80% warning     = floor(167236 × 0.80) = 133788 tokens
98% auto-compact = ceil(167236 × 0.98)  = 163892 tokens
```

These ratios apply to the **usable input budget**, not to the full 378144-token window.

### Automatic vs. manual operations

| Operation | Trigger | Scope | Uses LLM | Effect | Prerequisite |
|---|---|---:|---|---|---|
| 80% warning | Auto check before each `minimal` step | minimal only | No | Logs current input tokens, budget, and remaining headroom; no session change | Trusted token meter and model window |
| 98% auto summary compaction | Auto check before each `minimal` step | minimal only | Yes | Summarizes old history into a checkpoint, retains recent context; chunked for oversized input | Compaction engine loadable; agent maintainable |
| `/qwen38-compact` | User types the command | All presets incl. minimal | Yes | Lossy but information-preserving summary compaction | Command enabled; agent idle; `dsh-compaction-basic` resolvable |
| `/qwen38-new-context` | User types the command | All presets incl. minimal | No | Instant fresh model-visible window; old visible history dropped, raw event log kept | Agent idle; resetable history exists |

The automatic policy never performs a hard reset by itself. Hard reset drops model-visible history and is reserved for explicit manual confirmation.

### Budget source priority

1. Plugin setting override matching the server's actual limit;
2. DSH `resolveModelInfo()` → `context.contextWindow` and `defaultMaxTokens`;
3. Model-level manual configuration;
4. If no trusted window/output limit can be obtained, auto-compaction is skipped with a logged reason.

For the current NInfer model, configure `378144` and `192000` explicitly; do not keep the old `369144` window value.

## Implemented features

### 1. Compaction request fixing

For allow-listed models, the plugin can, on compaction and title auxiliary requests:

- disable thinking;
- write `reasoning_effort`;
- write non-thinking sampling parameters;
- raise the compaction request's output cap to the configured floor;
- leave out-of-allow-list requests byte-identical.

Gateway differences:

| Gateway | Thinking-off mechanism |
|---|---|
| llama.cpp / Unsloth Studio | `chat_template_kwargs.enable_thinking: false` + `reasoning_effort` |
| NInfer | `reasoning_effort` only; `chat_template_kwargs` never sent |

### 2. Oversized-conversation chunked rescue

When a conversation grew under a large-window model and the route switched to a smaller-window model, a single summarization request may not fit the history. The plugin, when safe conditions hold:

1. splits history into consecutive slices;
2. summarizes each slice;
3. merges the partial checkpoints;
4. returns the merged result to DSH as the summary checkpoint.

If the body cannot be parsed safely, the model window is unknown, the slice count exceeds the cap, or a mid-flight failure occurs, the plugin fails open — it never fabricates a success.

### 3. `/qwen38-compact`

Model summarization compaction. It replaces the compactable history with a summary checkpoint, preserving as much task information as possible, but summaries remain lossy and local 27B runs can be slow.

### 4. `/qwen38-new-context`

A local manual counterpart of the Codex hard-rollover direction: no LLM call, a fixed short marker replaces the current model-visible surface. The raw session event log stays on disk; files, git, running services, and external state are untouched.

Use it when task state already lives in code, files, git, or databases. Do not use it for Q&A that depends on the full conversation.

## Configuration

Settings file: `$DSH_HOME/settings.yaml`; for the dev profile, usually `~/.dsh-dev/settings.yaml`.

```yaml
qwen38-gateway-compaction:
  models:
    - Qwen3.8-27B-GGUF
    - qwen3.8-27b

  ninModels:
    - qwen3.8-27b

  maxTokensFloor: 16384
  wireReasoning: none
  enableThinkingOff: true

  chunking:
    enabled: true
    contextWindows:
      Qwen3.8-27B-GGUF: 262144
      qwen3.8-27b: 378144
    chunkRatio: 0.7
    chunkMaxTokens: 8192
    mergeMaxTokens: 16384
    maxChunks: 8

  # minimal-only policy; design config, active once the corresponding
  # implementation version is installed.
  minimalContext:
    enabled: true
    warningRatio: 0.8
    autoCompactRatio: 0.98
    safetyMarginRatio: 0.05
    contextWindows:
      qwen3.8-27b: 378144
    maxOutputTokens:
      qwen3.8-27b: 192000

  command:
    enabled: true
    newContext:
      enabled: true
```

`warningRatio`, `autoCompactRatio`, `safetyMarginRatio`, and the per-model window/max-output settings should be editable in the settings page. Constraints:

```text
0 < warningRatio < autoCompactRatio <= 1
0 <= safetyMarginRatio < 1
contextWindow - maxOutputTokens - ceil(contextWindow × safetyMarginRatio) > 0
```

## Installation

```sh
dsh-dev plugin --profile web add \
  /home/wwt/Downloads/aigc/proj/deepseek/dsh-plugins/dsh-qwen38-gateway-compaction
```

Restart the dev service after install or upgrade:

```sh
systemctl --user restart dsh-dev-web
```

Remove:

```sh
dsh-dev plugin --profile web rm dsh-qwen38-gateway-compaction
```

## Codex token-budget takeaways

Codex's token-budget compaction is not a plain model API parameter; it is a client/backend coordination feature that opens a fresh context window instead of asking the model to summarize all old history.

Plugin-side (achievable here):

- budget computation;
- proactive warning;
- minimal-only automatic summary;
- manual hard reset;
- raw event log retention.

Model/server-side (still required):

- exact tokenizer counts;
- real context window and max-output limits;
- input/output/cache token usage;
- KV/prefix cache capabilities.

Therefore the robust split is: **budget and lifecycle orchestrated by the plugin; capacity and exact token data provided by the server/API.** Injecting "remaining budget" into every ordinary conversation request is not recommended for the first version.

## Tests

```sh
node test/smoke.mjs
node test/integration-fetch.mjs
node test/preset-applicability.mjs
node test/rescue-e2e.mjs
node test/client-smoke.mjs
```

## License

MIT, see [`LICENSE`](./LICENSE).
