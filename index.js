/**
 * qwen3.8-27b (llama.cpp gateway, e.g. Unsloth Studio) compaction thinking fix:
 * auxiliary LLM calls (compaction summarization AND session-title generation)
 * run with thinking OFF and a `max_tokens` floor — but ONLY for the models in
 * the `models` allow-list (`Qwen3.8-27B-GGUF` by default). Every other model
 * passes through byte-identical with its route defaults. In addition, when the
 * conversation to be compacted is LARGER than the target model's context
 * window (the classic "chatted on a 1M-context model, then switched to a
 * 250k-context local model" case), the single-shot summarization call cannot
 * fit and dsh reports it as un-compactable; this plugin rescues exactly that
 * case with a chunked map-reduce summarization at the wire level.
 *
 * Why feature 1 exists: local qwen3.8-27b deployments served by llama.cpp (here
 * via Unsloth Studio's OpenAI-compatible endpoint) think at their default
 * level on every call that does not explicitly disable thinking. The two
 * auxiliary calls DSH issues on the conversation's own route — compaction
 * summarization and session-title generation — carry small output budgets; the
 * model spends that entire budget on reasoning tokens, finishes `length` with
 * empty or truncated content, and the summarizer reports "truncated at the
 * token cap" while every generated title fails back to the first-prompt
 * fallback. This plugin turns thinking off for exactly those calls, applies
 * non-thinking-appropriate sampling settings, and restores the collapsed
 * `max_tokens` budget — gated to a model allow-list so nothing else is touched.
 *
 * Why feature 2 exists: dsh-compaction-basic summarizes with ONE llm/stream
 * call that replays the whole selected range as input. When the conversation
 * grew under a large-window model (e.g. 1M) and the route then switches to a
 * small-window model (e.g. 250k), even the retained-tail-free range exceeds
 * the new window: the summarization request itself overflows, every retry does
 * the same, and the session is stuck with "cannot compact" plus repeated
 * context-overflow errors on every turn. This plugin detects that situation at
 * the wire level (estimated prompt tokens of the compaction body exceed a
 * fraction of the model's configured window) and, instead of forwarding an
 * unforwardable request, runs the summarization itself: it splits the message
 * range into consecutive slices that fit, summarizes each slice with thinking
 * off, merges the partial checkpoints in one final call, and returns the merged
 * checkpoint to dsh as if the single-shot call had succeeded. The original
 * request is never sent when the rescue commits; every guard fails open, so a
 * miss or a mid-flight failure degrades to today's behavior, never worse.
 *
 * Wire fields for feature 1 (verified against llama.cpp build 10798 served
 * through Unsloth Studio; both mechanisms independently suppress thinking):
 *   - `chat_template_kwargs: { "enable_thinking": false }` — the Qwen3 chat
 *     template variable; the primary, documented switch for Qwen3 GGUF models
 *     on llama.cpp.
 *   - `reasoning_effort: "none"` — newer llama.cpp builds map this onto the
 *     chat template as well; sent as a second, independent belt-and-braces
 *     field.
 *
 * Layer 1: the `llm/stream` waterfall stamps `reasoningEffort: "off"` on calls
 * whose `purpose` is in `purposes` (default: `["compaction"]`, the compaction
 * engine's own tag) AND whose `options.model` is in `models`. This only fires
 * when the model's settings.yaml declaration offers expressible reasoning
 * efforts; for undeclared models it stays silent and layers 2+4 do the work at
 * the wire level.
 *
 * Layer 2 (HTTP compaction body): compaction summarization needs thinking off
 * AND sampling settings that the LLM options surface does not carry (`top_p`,
 * `top_k`, `min_p`, `presence_penalty`, `repetition_penalty`; `temperature` is
 * carried, but is applied here too so the whole parameter set lands in one
 * place). The OpenAI-compatible request body is built and stringified
 * downstream of the waterfall, so this plugin wraps the process-global
 * `fetch`: for chat-completion bodies that ARE the compaction summarization
 * call AND whose `model` field is in `models`, it merges
 * `chat_template_kwargs.enable_thinking = false` (preserving any other
 * template kwargs), writes the configured `reasoning_effort` wire value,
 * applies the configured `sampling` entries, and raises the output cap to the
 * floor.
 *
 * Layer 3 (HTTP max_tokens floor): pi-ai clamps every request's `max_tokens`
 * client-side (`clampMaxTokensToContext`): it estimates the context size from
 * the messages and requests at most `contextWindow − estimate − 4096` output
 * tokens, floored at 1. The estimator only uses real (server-reported) token
 * counts when a replayed assistant message carries usage — dsh-llm-pi-ai
 * rebuilds replayed assistant messages with zeroed usage, so for any large
 * conversation the estimator falls back to a chars/4 heuristic that
 * overestimates dense content severalfold. When the heuristic estimate
 * approaches the context window, the clamp collapses `max_tokens` to 1: the
 * model emits a single token, finishes `output_limit`, and dsh-compaction-
 * basic reports "summarization truncated at the token cap (incomplete
 * checkpoint)" even though the server (which knows the real prompt size) had
 * ample room. This layer restores the intended output budget on compaction
 * bodies only: it RAISES `max_tokens` to the configured floor, never lowers
 * it, and only on bodies carrying the compaction signature for an allowed
 * model. When headroom is genuinely scarce the server clamps to its real
 * capacity and finishes with an honest `context_capacity` stop — never worse
 * than today's 1-token result.
 *
 * Layer 4 (HTTP session-title thinking off): the session-title provider
 * (dsh-session-title-llm) issues its auxiliary call with a tiny output budget
 * (`maxTokens: 64` by composition default). On a gateway whose model thinks by
 * default, the model spends the entire 64-token budget on reasoning tokens,
 * finishes `length` with EMPTY content, and every generated title fails back
 * to the deterministic first-prompt fallback. The title plugin also deep-
 * freezes its LLM options BEFORE the `llm/stream` waterfall, so layer 1's
 * in-place stamp cannot reach it (the try/catch around the stamp exists for
 * exactly that case). This layer reaches the call where the frozen object no
 * longer matters — the wire body: when the chat-completion body carries the
 * title system prompt (see `TITLE_SIGNATURE`) AND its `model` field is in
 * `models`, it writes the same thinking-off wire fields as layer 2, so the
 * title model emits plain text within the 64-token budget. The title plugin's
 * own `max_tokens` is left exactly as set (the floor is compaction-only).
 *
 * Layer 5 (HTTP oversized-compaction rescue, feature 2): after layer 2 has
 * rewritten a compaction body, this layer estimates the prompt size of that
 * body. When it exceeds `chunkRatio × contextWindows[model]` and chunking is
 * enabled for that model, the wrapper does NOT forward the original request.
 * Instead it:
 *   - splits the message range into consecutive slices whose estimated input
 *     fits under the per-call budget (leading system/developer messages are
 *     re-sent with every slice; a `tool`-role message is never left orphaned
 *     at a slice start; a single message that alone exceeds the budget is
 *     head/tail-truncated for the internal call only — the durable surface is
 *     untouched);
 *   - summarizes each slice sequentially with `stream: false`, thinking off,
 *     the configured sampling, and `max_tokens = chunkMaxTokens` (each slice
 *     call receives the conversation's own final compaction instruction
 *     verbatim as its last user message);
 *   - merges the partial checkpoints in one final call (partials wrapped in
 *     `<compacted-summary>` tags, same final instruction) with
 *     `max_tokens = mergeMaxTokens`;
 *   - returns the merged checkpoint to dsh as a standard OpenAI response — an
     SSE stream with periodic keep-alive pings when the original request was
     streaming (pi-ai's 300s stream-idle timeout would otherwise kill a
     multi-minute rescue), or plain JSON otherwise.
 * `tools` schemas are dropped from the internal calls (the checkpoint does not
 * need them and they would be re-paid on every slice). When the rescue commits,
 * keep-alive pings hold the synthetic stream open while slices run; if any
 * slice or the merge ultimately fails (after one retry each), the stream ends
 * with EMPTY content, which dsh-compaction-basic rejects as "summarization
 * produced no text summary content" — the exact same safe outcome as today's
 * overflow failure: the conversation surface is preserved and the attempt is
 * logged. Pre-commit guards (unknown model window, more slices than
 * `maxChunks`, unparseable body) fail open by forwarding the original request
 * untouched.
 *
 * Identity for layers 2+3+5 is the compaction engine's own instruction:
 * dsh-compaction-basic appends it as the FINAL user message of every
 * compaction call, so its first line is a stable signature in the body. (If a
 * future dsh release changes that instruction, the HTTP gate silently stops
 * matching and the body keeps its wire defaults; the effort layer is
 * unaffected.)
 *
 * Per-call semantics (waterfall layer):
 *   - only calls whose `purpose` is in `purposes` AND whose `options.model`
 *     is in `models` are touched;
 *   - a call that already carries an explicit `reasoningEffort` wins —
 *     per-call beats the plugin default;
 *   - effort preference order: configured, then `off`, then `low`; a model
 *     offering none of them is left at its own default (one-time warning, and
 *     only when the wire-level thinking-off gates are also disabled);
 *   - `effort: ""` disables the effort policy.
 *
 * Configuration precedence (re-projected on every LLM call, so settings.yaml
 * edits apply without a restart):
 *   1. `qwen38-llamacpp-compaction-fix:` section of `$DSH_HOME/settings.yaml`
 *   2. the `config:` block of this plugin's row in the profile's
 *      `cordis.patch.yml`
 *   3. built-in defaults (effort `"off"`, purposes `["compaction"]`,
 *      models `["Qwen3.8-27B-GGUF"]`)
 */
import z from "@deepseek-ai/schemastery";

// dsh-settings has two API generations, and which one this module resolves to
// depends on the host (npm releases vs source builds):
//   - 0.1.1-rc.x: free functions `installSettingsSection` / `settingsNamespace`
//     exported from the package;
//   - >= 0.1.3:   no free functions; the settings SERVICE exposes
//     `ctx.settings.installSection(owner, ns, schema, entry, hooks)` and
//     consumers reach it through the optional `ctx.inject(["settings"], cb)`.
// Import dynamically so one plugin source works with both; when neither
// surface is available (or no settings service is mounted), the composition
// entry — resolved against the schema below — remains the policy source.
const settingsApi = await import("@deepseek-ai/dsh-settings").catch(() => null);

/** Cordis plugin name used by loader diagnostics. */
const name = "qwen38-llamacpp-compaction-fix";
/** Hard dependency: the LLM service owns the `llm/stream` waterfall. */
const inject = ["llm"];

/** Default summarization effort: thinking off, not the conversation's default. */
const DEFAULT_EFFORT = "off";
/** Primary fallback: the whole point is no thinking. */
const OFF_EFFORT = "off";
/** Secondary fallback when `off` is not expressible. */
const FALLBACK_EFFORT = "low";
/** LLM call purposes this policy applies to by default. */
const DEFAULT_PURPOSES = ["compaction"];
/**
 * Default model allow-list: the llama.cpp deployment this plugin was tuned
 * for (Unsloth Studio serves the loaded Qwen3.8-27B GGUF under this id, as
 * reported by its `/v1/models`). Exact id match against `settings.yaml`'s
 * `llm-pi-ai.providers.<provider>.models[].id`. An empty list disables the
 * policy.
 */
const DEFAULT_MODELS = ["Qwen3.8-27B-GGUF"];
/**
 * Default `reasoning_effort` wire value written into matched request bodies
 * (layers 2 and 4). Verified accepted by llama.cpp build 10798, where it maps
 * onto the Qwen3 chat template; `""` disables that field write entirely.
 */
const DEFAULT_WIRE_REASONING = "none";
/**
 * Default `max_tokens` floor for compaction bodies. dsh-compaction-basic's
 * own budget defaults to 8192; 16384 gives the summary headroom while staying
 * far below the headroom a 250k-token window leaves a large prompt. `0` (or
 * `null`) disables the floor.
 */
const DEFAULT_MAX_TOKENS_FLOOR = 16384;
/** Default: the oversized-compaction rescue is on. */
const DEFAULT_CHUNKING_ENABLED = true;
/**
 * Default per-slice input budget as a fraction of the model's context window.
 * The remainder covers the instruction, estimation error, and the slice's own
 * output cap.
 */
const DEFAULT_CHUNK_RATIO = 0.7;
/** Default output cap for one partial (per-slice) summary. */
const DEFAULT_CHUNK_MAX_TOKENS = 8192;
/** Default output cap for the final merged checkpoint. */
const DEFAULT_MERGE_MAX_TOKENS = 16384;
/** Default safety cap on the number of partial summaries per rescue. */
const DEFAULT_MAX_CHUNKS = 8;
/** Extra headroom (tokens) subtracted from the per-slice budget for estimation error. */
const CHUNK_MARGIN_TOKENS = 1024;
/** Interval between keep-alive pings on a synthetic stream while slices run. */
const KEEPALIVE_MS = 15000;
/** First keep-alive poll after the head chunk (short, so fast rescues stay snappy). */
const FIRST_KEEPALIVE_MS = 2000;
/** Wire field names of the supported sampling settings. Keys are written verbatim into the OpenAI-compatible chat-completion body; llama.cpp's server accepts all of them. */
const SAMPLING_KEYS = [
  "temperature",
  "top_p",
  "top_k",
  "min_p",
  "presence_penalty",
  "repetition_penalty"
];
/** Wire field names of the output cap, in the order the OpenAI-compatible surface may spell it. */
const MAX_TOKEN_KEYS = ["max_tokens", "max_completion_tokens"];
/** Body fields that internal (slice/merge) calls rebuild explicitly. */
const INTERNAL_CALL_REBUILT_FIELDS = ["messages", "tools", "stream", "max_tokens", "max_completion_tokens"];

/**
 * Sampling settings object; every field optional (a plain schemastery field
 * is nullable: absent keys stay absent), wire-named.
 */
const SamplingParams = z.object({
  /** Sample temperature for the summarization call. */
  temperature: z.number(),
  /** Nucleus sampling probability mass. */
  top_p: z.number(),
  /** Keep the top-K candidate tokens. */
  top_k: z.number(),
  /** Minimum token probability relative to the best token. */
  min_p: z.number(),
  /** Bias against already-present tokens. */
  presence_penalty: z.number(),
  /** Multiplicative penalty for repeated tokens (1.0 = neutral). */
  repetition_penalty: z.number()
});

/**
 * Oversized-compaction rescue config (feature 2). Every field optional;
 * defaults applied by the schema.
 */
const ChunkingConfig = z.object({
  /** Master switch for the chunked map-reduce rescue. Default `true`. */
  enabled: z.boolean().default(DEFAULT_CHUNKING_ENABLED),
  /**
   * Exact model id → context window (tokens) used to decide when a compaction
   * prompt is too large for one call. Models absent from this map are NEVER
   * chunked (the rescue fails open to the original single-shot behavior).
   * Default `{}`.
   */
  contextWindows: z.dict(z.number()).default({}),
  /** Per-slice input budget as a fraction of the model window, in (0, 1]. Default `0.7`. */
  chunkRatio: z.number().default(DEFAULT_CHUNK_RATIO),
  /** Output cap (`max_tokens`) for one partial per-slice summary. Default `8192`. */
  chunkMaxTokens: z.number().default(DEFAULT_CHUNK_MAX_TOKENS),
  /** Output cap (`max_tokens`) for the final merged checkpoint. Default `16384`. */
  mergeMaxTokens: z.number().default(DEFAULT_MERGE_MAX_TOKENS),
  /** Safety cap on partial summaries per rescue; a larger range fails open. Default `8`. */
  maxChunks: z.number().default(DEFAULT_MAX_CHUNKS)
});

/**
 * Manual compaction command config (feature 3). The `/qwen38-compact` slash
 * command runs the official dsh-compaction-basic manual transaction on the
 * receiving session — including sessions whose agent preset ships no
 * compaction engine at all (e.g. the minimal preset), where neither automatic
 * compaction nor the built-in `/compact` exist.
 */
const CommandConfig = z.object({
  /** Master switch for the `/qwen38-compact` command. Default `true`. */
  enabled: z.boolean().default(true)
});

/** Plugin config (all keys optional; defaults applied by the schema). */
const Config = z.object({
  /** Reasoning effort stamped onto matched calls. `""` disables the effort policy. Default `"off"`. */
  effort: z.string().default(DEFAULT_EFFORT),
  /** `purpose` tags of LLM calls the policy applies to. Default `["compaction"]`. */
  purposes: z.array(z.string()).default(DEFAULT_PURPOSES),
  /**
   * Exact model ids the policy applies to (case-sensitive, as declared in
   * settings.yaml). A call/body whose model is not in this list passes
   * through untouched. Empty list disables the policy entirely.
   * Default `["Qwen3.8-27B-GGUF"]`.
   */
  models: z.array(z.string()).default(DEFAULT_MODELS),
  /** Sampling settings applied to compaction request bodies; `{}` leaves sampling untouched. */
  sampling: SamplingParams.default({}),
  /**
   * `max_tokens` floor applied to compaction request bodies: the wire value
   * is raised to at least this number so the summarizer gets its output
   * budget back when pi-ai's client-side context clamp collapsed it (the
   * clamp estimates context from a chars/4 heuristic for replayed history,
   * which overestimates dense conversations and can drive `max_tokens` to 1).
   * Never lowers the value. `0` or `null` disables the floor. Default 16384.
   */
  maxTokensFloor: z.number().default(DEFAULT_MAX_TOKENS_FLOOR),
  /**
   * `reasoning_effort` wire value written into matched request bodies (layers
   * 2 and 4). llama.cpp maps it onto the Qwen3 chat template; `""` disables
   * this field write (the `chat_template_kwargs` gate still applies). Default
   * `"none"`.
   */
  wireReasoning: z.string().default(DEFAULT_WIRE_REASONING),
  /**
   * When true, layers 2 and 4 merge `enable_thinking: false` into the body's
   * `chat_template_kwargs` (the Qwen3 template variable; other template
   * kwargs are preserved). When false, `chat_template_kwargs` is never
   * touched. Default `true`.
   */
  enableThinkingOff: z.boolean().default(true),
  /** Oversized-compaction rescue policy (feature 2); see ChunkingConfig. */
  chunking: ChunkingConfig.default({}),
  /** Manual `/qwen38-compact` command; see CommandConfig. */
  command: CommandConfig.default({})
});

/** Settings namespace carrying this plugin's policy (plain string; both dsh-settings generations validate the same kebab-case pattern). */
const COMPACT_EFFORT_SETTINGS_NAMESPACE = "qwen38-llamacpp-compaction-fix";

/**
 * First line of the dsh-compaction-basic summarization instruction, which the
 * engine appends as the final user message of every compaction call. Used to
 * identify those requests at the HTTP layer. (If a future dsh release changes
 * that instruction, the HTTP layers silently stop matching — the effort layer
 * is unaffected — and the body keeps its wire defaults.)
 */
export const COMPACTION_SIGNATURE = "You are now acting as a compaction engine for this AI coding assistant";

/**
 * First line of the dsh-session-title-llm system prompt, which the title
 * provider sends verbatim on every session-title call. Used to identify those
 * requests at the HTTP layer (layer 4): the title plugin's LLM options are
 * deep-frozen before the waterfall, so only the wire body is reachable.
 */
export const TITLE_SIGNATURE = "Create a concise title for an AI coding-assistant session from the supplied human messages";

/** Marks the wrapped global fetch so `apply` never double-wraps. */
const FETCH_WRAPPER_MARK = Symbol.for("qwen38-llamacpp-compaction-fix.fetch-wrapper");

/**
 * Current policy config source, rebound by every `apply` so a re-apply
 * (in-process profile reload) never leaves the installed wrapper pointing at
 * a stale config.
 */
let policySource = () => ({ entries: [], floor: 0, wireReasoning: "", enableThinkingOff: false, models: [], chunking: null });

/**
 * Numeric sampling entries from one resolved config, in wire-key order.
 * @returns `[]` when nothing finite is configured.
 */
function samplingEntries(sampling) {
  if (sampling === null || typeof sampling !== "object") return [];
  const entries = [];
  for (const key of SAMPLING_KEYS) {
    const value = sampling[key];
    if (typeof value === "number" && Number.isFinite(value)) entries.push([key, value]);
  }
  return entries;
}

/** Coerce a config number to a finite positive integer, or `fallback`. */
function positiveInt(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * The active HTTP-layer policy from one resolved config: the sampling
 * entries, an enabled max_tokens floor (0 = disabled), the `reasoning_effort`
 * wire value written into matched bodies ("" = field write disabled), whether
 * the `chat_template_kwargs.enable_thinking=false` merge is enabled, the model
 * allow-list ([] = policy disabled), and the normalized chunking policy (null
 * = rescue disabled).
 */
function policyOf(config) {
  const floorRaw = config?.maxTokensFloor;
  const floor = typeof floorRaw === "number" && Number.isFinite(floorRaw) && floorRaw > 0 ? Math.floor(floorRaw) : 0;
  const wireReasoning = typeof config?.wireReasoning === "string" ? config.wireReasoning : "";
  const enableThinkingOff = config?.enableThinkingOff === true;
  const models = Array.isArray(config?.models)
    ? config.models.filter((m) => typeof m === "string" && m.length > 0)
    : [];
  const raw = config?.chunking;
  let chunking = null;
  if (raw !== null && typeof raw === "object" && raw.enabled === true) {
    const ratio = typeof raw.chunkRatio === "number" && Number.isFinite(raw.chunkRatio) ? raw.chunkRatio : DEFAULT_CHUNK_RATIO;
    if (ratio > 0 && ratio <= 1) {
      chunking = {
        contextWindows: raw.contextWindows !== null && typeof raw.contextWindows === "object" ? raw.contextWindows : {},
        ratio,
        chunkMaxTokens: positiveInt(raw.chunkMaxTokens, DEFAULT_CHUNK_MAX_TOKENS),
        mergeMaxTokens: positiveInt(raw.mergeMaxTokens, DEFAULT_MERGE_MAX_TOKENS),
        maxChunks: positiveInt(raw.maxChunks, DEFAULT_MAX_CHUNKS)
      };
    }
  }
  return { entries: samplingEntries(config?.sampling), floor, wireReasoning, enableThinkingOff, models, chunking };
}

/**
 * Whether the policy's wire-level thinking-off gates are active at all (the
 * `chat_template_kwargs` merge and/or the `reasoning_effort` write).
 */
function thinkingOffActive(policy) {
  return policy?.enableThinkingOff === true || (typeof policy?.wireReasoning === "string" && policy.wireReasoning.length > 0);
}

/**
 * Extract the plain text of a chat-completion message content, whatever its
 * wire shape: a plain string, or an array of content blocks (the `text` fields
 * of the text-bearing blocks, joined). Anything else yields "".
 * @param content - the message's `content` field as parsed from the body.
 * @returns the concatenated text content.
 */
function messageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block !== null && typeof block === "object" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

/**
 * Whether the parsed body's `model` field is in the allow-list. Conservative:
 * a missing or non-string `model` never matches (no rewrite).
 * @param body - the parsed JSON chat-completion body.
 * @param models - the allow-list of exact model ids.
 * @returns true when the body targets an allowed model.
 */
function modelAllowed(body, models) {
  return Array.isArray(models) && typeof body?.model === "string" && models.includes(body.model);
}

/**
 * Write the thinking-off wire fields into a parsed chat-completion body:
 * merge `enable_thinking: false` into `chat_template_kwargs` (preserving any
 * other template kwargs already present) when enabled, and set
 * `reasoning_effort` to the configured value when configured. Never touches
 * any other field.
 * @param body - the parsed JSON chat-completion body (mutated in place).
 * @param policy - `{wireReasoning, enableThinkingOff}` from the current config.
 * @returns true when at least one wire field was written.
 */
export function applyThinkingOff(body, policy) {
  if (body === null || typeof body !== "object") return false;
  let changed = false;
  if (policy?.enableThinkingOff === true) {
    const existing = body.chat_template_kwargs;
    const target = existing !== null && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
    if (target.enable_thinking !== false) {
      target.enable_thinking = false;
      body.chat_template_kwargs = target;
      changed = true;
    }
  }
  const wire = typeof policy?.wireReasoning === "string" ? policy.wireReasoning : "";
  if (wire.length > 0 && body.reasoning_effort !== wire) {
    body.reasoning_effort = wire;
    changed = true;
  }
  return changed;
}

/**
 * Rewrite `init.body` in place when `init` carries the JSON chat-completion
 * body of a compaction summarization call FOR AN ALLOWED MODEL: write the
 * thinking-off wire fields, apply the sampling entries, and raise the output
 * cap to the floor. Every guard is conservative: any shape mismatch, parse
 * failure, missing signature, or disallowed model leaves the request
 * untouched.
 * @param init - the fetch init holding the stringified JSON body.
 * @param policy - `{entries, floor, wireReasoning, enableThinkingOff, models}` from the current config.
 * @returns true when the body was rewritten.
 */
export function rewriteCompactionBody(init, policy) {
  if (policy === null || typeof policy !== "object") return false;
  const entries = Array.isArray(policy.entries) ? policy.entries : [];
  const floor = typeof policy.floor === "number" && Number.isFinite(policy.floor) && policy.floor > 0 ? policy.floor : 0;
  const models = Array.isArray(policy.models) ? policy.models : [];
  if (entries.length === 0 && floor === 0 && !thinkingOffActive(policy)) return false;
  if (models.length === 0) return false;
  if (init === null || typeof init !== "object") return false;
  if (typeof init.body !== "string" || init.body.length === 0) return false;
  // Cheap pre-filter before parsing a potentially large body.
  if (!init.body.includes(COMPACTION_SIGNATURE)) return false;
  let body;
  try {
    body = JSON.parse(init.body);
  } catch {
    return false;
  }
  if (body === null || typeof body !== "object") return false;
  // Model gate: only rewrite bodies targeting an allowed model.
  if (!modelAllowed(body, models)) return false;
  if (!Array.isArray(body.messages) || body.messages.length === 0) return false;
  const last = body.messages[body.messages.length - 1];
  if (last === null || typeof last !== "object" || last.role !== "user") return false;
  // The compaction engine appends its instruction as the FINAL user message,
  // verbatim and unmodified — so a real compaction call's final user text
  // STARTS with the signature. Requiring the prefix (instead of searching
  // anywhere in the body) keeps this gate from matching conversation turns
  // that merely quote the signature inside tool results or history.
  const text = messageText(last.content);
  if (!text.startsWith(COMPACTION_SIGNATURE)) return false;
  let changed = applyThinkingOff(body, policy);
  for (const [key, value] of entries) {
    if (typeof key === "string" && typeof value === "number") {
      body[key] = value;
      changed = true;
    }
  }
  if (floor > 0) {
    for (const key of MAX_TOKEN_KEYS) {
      // RAISE ONLY: a cap the pipeline already set (larger or equal) is never
      // reduced; a collapsed cap (pi-ai's clamp) is restored.
      if (typeof body[key] === "number" && body[key] < floor) {
        body[key] = floor;
        changed = true;
      }
    }
  }
  // Strip tool schemas: the summarization prompt is self-contained text, and
  // Qwen3 on llama.cpp answers a tools-bearing thinking-off request with a
  // TOOL CALL (empty content) instead of the Markdown checkpoint — which dsh
  // then rejects as "no text summary content". Measured on build 10798:
  // tools + thinking off → finish_reason tool_calls, content ""; the same
  // body without tools → a proper checkpoint. (The engine keeps the tools in
  // the prompt only for KV-cache prefix affinity; correctness wins.)
  if ("tools" in body || "tool_choice" in body) {
    delete body.tools;
    delete body.tool_choice;
    changed = true;
  }
  if (!changed) return false;
  init.body = JSON.stringify(body);
  return true;
}

/**
 * Rewrite `init.body` in place when `init` carries the JSON chat-completion
 * body of a session-title call FOR AN ALLOWED MODEL: write the thinking-off
 * wire fields so the gateway does not spend the 64-token title budget on
 * thinking. The compaction engine's own wire `max_tokens`/
 * `max_completion_tokens` is left exactly as the title plugin set it (the
 * floor and sampling are compaction-only). Every guard is conservative: any
 * shape mismatch, parse failure, missing signature, or disallowed model leaves
 * the request untouched.
 * @param init - the fetch init holding the stringified JSON body.
 * @param policy - `{wireReasoning, enableThinkingOff, models}` from the current config.
 * @returns true when the body was rewritten.
 */
export function rewriteTitleBody(init, policy) {
  if (policy === null || typeof policy !== "object") return false;
  const models = Array.isArray(policy.models) ? policy.models : [];
  if (!thinkingOffActive(policy)) return false;
  if (models.length === 0) return false;
  if (init === null || typeof init !== "object") return false;
  if (typeof init.body !== "string" || init.body.length === 0) return false;
  // Cheap pre-filter before parsing the body.
  if (!init.body.includes(TITLE_SIGNATURE)) return false;
  let body;
  try {
    body = JSON.parse(init.body);
  } catch {
    return false;
  }
  if (body === null || typeof body !== "object") return false;
  // Model gate: only rewrite bodies targeting an allowed model.
  if (!modelAllowed(body, models)) return false;
  if (!Array.isArray(body.messages) || body.messages.length === 0) return false;
  // Confirm the signature actually sits in the TITLE PROMPT itself: the title
  // provider sends it as the system prompt (adapter-mapped role, e.g.
  // `developer` or `system`), verbatim and unmodified — so a real title call's
  // system text STARTS with the signature. Requiring a system/developer role
  // plus a prefix match keeps this gate from matching conversation turns that
  // merely quote the signature inside tool results or history (e.g. while
  // debugging this very plugin).
  let matched = false;
  for (const message of body.messages) {
    if (message === null || typeof message !== "object") continue;
    if (message.role !== "system" && message.role !== "developer") continue;
    if (messageText(message.content).startsWith(TITLE_SIGNATURE)) { matched = true; break; }
  }
  if (!matched) return false;
  let changed = applyThinkingOff(body, policy);
  // Same tool-call trap as the compaction call: a thinking-off request that
  // carries tool schemas can come back as a tool call with no title text.
  if ("tools" in body || "tool_choice" in body) {
    delete body.tools;
    delete body.tool_choice;
    changed = true;
  }
  if (!changed) return false;
  init.body = JSON.stringify(body);
  return true;
}

// ---------------------------------------------------------------------------
// Feature 2: oversized-compaction rescue (chunked map-reduce at the wire level)
// ---------------------------------------------------------------------------

/** Count CJK-weighted characters in a string (conservative token estimation). */
function countCjk(text) {
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (
      (c >= 0x4e00 && c <= 0x9fff) || // CJK unified ideographs
      (c >= 0x3400 && c <= 0x4dbf) || // extension A
      (c >= 0xf900 && c <= 0xfaff) || // compatibility ideographs
      (c >= 0x3000 && c <= 0x303f) || // CJK punctuation
      (c >= 0xff00 && c <= 0xffef) // fullwidth forms
    ) {
      cjk += 1;
    }
  }
  return cjk;
}

/**
 * Conservative token estimate for one text: CJK characters count ~1 token each
 * (the dsh token-meter's chars/4 heuristic underprices CJK badly, and this
 * gate prefers to chunk early rather than overflow late); everything else
 * counts ~4 chars per token.
 * @param text - the text to estimate.
 * @returns the estimated token count (0 for non-strings).
 */
export function estimateTextTokens(text) {
  if (typeof text !== "string" || text.length === 0) return 0;
  const cjk = countCjk(text);
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

/** Conservative token estimate for one chat-completion message. */
export function estimateMessageTokens(message) {
  if (message === null || typeof message !== "object") return 0;
  let tokens = 6; // role + structural overhead
  tokens += estimateTextTokens(messageText(message.content));
  const toolCalls = message.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    try {
      tokens += Math.ceil(JSON.stringify(toolCalls).length / 4);
    } catch {
      tokens += 256;
    }
  }
  // Image blocks: priced flat and conservatively (vision token counts vary by
  // resolution and are not visible on the wire).
  if (Array.isArray(message.content)) {
    const images = message.content.filter((block) => block !== null && typeof block === "object" && (block.type === "image_url" || block.image_url !== undefined)).length;
    tokens += images * 1024;
  }
  return tokens;
}

/**
 * Conservative token estimate for a whole chat-completion body's prompt: all
 * messages plus the `tools` schemas (when present). This is deliberately an
 * OVER-estimate for CJK-dense content: a false "oversized" verdict costs one
 * chunked rescue; a false "fits" verdict costs an overflow failure.
 * @param body - the parsed JSON chat-completion body.
 * @returns the estimated prompt token count.
 */
export function estimateBodyTokens(body) {
  if (body === null || typeof body !== "object") return 0;
  let tokens = 0;
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) tokens += estimateMessageTokens(message);
  }
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    try {
      tokens += Math.ceil(JSON.stringify(body.tools).length / 4);
    } catch {
      tokens += 1024;
    }
  }
  return tokens;
}

/** Observed token density of a text (tokens per char), from the same heuristic as the estimator. */
function textDensity(text) {
  if (typeof text !== "string" || text.length === 0) return 0.25;
  const cjk = countCjk(text);
  return Math.max((cjk + (text.length - cjk) / 4) / text.length, 0.25);
}

/**
 * Head/tail-truncate a text to roughly `targetLen` characters (70% head, 25%
 * tail, marker in the middle).
 */
function shrinkText(text, targetLen) {
  if (text.length <= targetLen) return text;
  const headLen = Math.floor(targetLen * 0.7);
  const tailLen = Math.floor(targetLen * 0.25);
  return `${text.slice(0, headLen)}\n[... dsh-qwen38-llamacpp-compaction-fix: truncated ${text.length - headLen - tailLen} chars to fit the chunk budget ...]\n${text.slice(text.length - tailLen)}`;
}

/**
 * Truncate one message's text content until its estimate fits `budget` — for
 * INTERNAL chunk calls only; the durable conversation surface is never
 * touched. The target length adapts to the text's own token density (a pure-
 * CJK text needs ~4x fewer chars than an ASCII one for the same budget), and
 * each round halves the allowance if the marker overhead still overflows.
 * Non-text shapes pass through unchanged.
 * @param message - the message to shrink.
 * @param budget - the target token budget.
 * @returns a (possibly new) message object that fits, or the original when it already does.
 */
export function truncateMessageToBudget(message, budget) {
  if (message === null || typeof message !== "object") return message;
  let current = message;
  for (let round = 0; round < 6 && estimateMessageTokens(current) > budget; round++) {
    const content = current.content;
    const allowance = Math.max(budget / 2 ** round, 1);
    if (typeof content === "string" && content.length > 64) {
      const targetLen = Math.max(32, Math.floor(allowance / textDensity(content)));
      current = { ...current, content: shrinkText(content, targetLen) };
      continue;
    }
    if (Array.isArray(content)) {
      // Shrink the largest text-bearing block.
      let bestIndex = -1;
      let bestLen = 0;
      for (let i = 0; i < content.length; i++) {
        const block = content[i];
        if (block !== null && typeof block === "object" && typeof block.text === "string" && block.text.length > bestLen) {
          bestIndex = i;
          bestLen = block.text.length;
        }
      }
      if (bestIndex < 0 || bestLen <= 64) return current; // nothing text-shaped left to shrink
      const text = content[bestIndex].text;
      const targetLen = Math.max(32, Math.floor(allowance / textDensity(text)));
      const next = content.slice();
      next[bestIndex] = { ...content[bestIndex], text: shrinkText(text, targetLen) };
      current = { ...current, content: next };
    } else {
      return current; // no text to truncate
    }
  }
  return current;
}

/**
 * Split a compaction body's message range into consecutive slices whose
 * estimated input fits `sliceBudget`:
 *   - leading system/developer messages are peeled off and returned as
 *     `prefix` (re-sent with every internal call);
 *   - a `tool`-role message is never the first message of a slice (it would be
 *     orphaned from its assistant `tool_calls`);
 *   - a single message that alone exceeds the budget is truncated in place
 *     (internal-call copy only).
 * @param messages - the body's full message array (instruction included; the caller strips it).
 * @param sliceBudget - per-slice input token budget.
 * @returns `{ prefix, slices }` with `slices` an array of message arrays in order, or null when nothing usable remains.
 */
export function sliceMessages(messages, sliceBudget) {
  if (!Array.isArray(messages) || messages.length === 0 || !(sliceBudget > 0)) return null;
  let start = 0;
  const prefix = [];
  while (start < messages.length) {
    const m = messages[start];
    if (m !== null && typeof m === "object" && (m.role === "system" || m.role === "developer")) {
      prefix.push(m);
      start += 1;
    } else break;
  }
  const rest = messages.slice(start);
  const slices = [];
  let cur = [];
  let curTokens = 0;
  for (let i = 0; i < rest.length; i++) {
    const raw = rest[i];
    if (raw === null || typeof raw !== "object") continue; // malformed entries cannot be priced or sent usefully
    let msg = raw;
    let tokens = estimateMessageTokens(msg);
    if (tokens > sliceBudget) {
      msg = truncateMessageToBudget(msg, sliceBudget);
      tokens = estimateMessageTokens(msg);
    }
    const startsNewSlice = cur.length > 0 && curTokens + tokens > sliceBudget;
    if (startsNewSlice && msg.role === "tool") {
      // Orphan guard: a tool result must stay with its assistant tool_calls.
      // The previous slice overflows its budget; that is the lesser evil.
    } else if (startsNewSlice) {
      slices.push(cur);
      cur = [];
      curTokens = 0;
    }
    cur.push(msg);
    curTokens += tokens;
  }
  if (cur.length > 0) slices.push(cur);
  if (slices.length === 0) return null;
  return { prefix, slices };
}

/**
 * Build one internal (slice or merge) request body from the rewritten
 * compaction body: keeps model + sampling + thinking-off fields, drops
 * `tools`/`stream`/output caps, and installs the given messages.
 * @param body - the rewritten compaction body.
 * @param messages - the internal call's message array.
 * @param maxTokens - the output cap for this internal call.
 * @returns a fresh plain object safe to stringify.
 */
export function buildInternalBody(body, messages, maxTokens) {
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (INTERNAL_CALL_REBUILT_FIELDS.includes(key)) continue;
    out[key] = value;
  }
  out.stream = false;
  out.max_tokens = maxTokens;
  out.messages = messages;
  return out;
}

/** One SSE `data:` line for a chat.completion.chunk. */
function sseChunk(id, created, model, delta, finishReason) {
  const obj = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason === undefined ? null : finishReason }]
  };
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** A complete non-stream chat.completion JSON response. */
function jsonResponse(id, created, model, content) {
  return new Response(
    JSON.stringify({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

/**
 * Run one internal non-streaming chat-completion call through the ORIGINAL
 * fetch (bypassing this wrapper), and return its assistant text.
 * @param originalFetch - the unwrapped global fetch.
 * @param baseReq - a Request carrying url/headers/signal of the original call.
 * @param body - the internal request body.
 * @returns `{ content, finishReason }`; throws on HTTP or shape failure.
 */
async function internalCall(originalFetch, baseReq, body) {
  const req = new Request(baseReq, { body: JSON.stringify(body), signal: baseReq.signal });
  const res = await originalFetch(req);
  if (!res.ok) throw new Error(`internal call failed: HTTP ${res.status}`);
  const data = await res.json();
  const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
  const content = choice !== null && typeof choice === "object" && typeof choice.message?.content === "string" ? choice.message.content : "";
  return { content, finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null };
}

/** Run an async fn with one retry; returns the value or throws the last error. */
async function withRetry(fn) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * The oversized-compaction rescue (layer 5 / feature 2). Called ONLY after
 * layer 2 has confirmed `init` is a compaction body for an allowed model.
 * Estimates the prompt; when it fits under the per-call budget, or chunking is
 * disabled/unknown for this model, returns undefined and the original request
 * is forwarded untouched. Otherwise commits to the map-reduce and returns a
 * synthetic Response (SSE stream or JSON) that dsh consumes as the summary.
 * Every guard fails open; a mid-flight failure ends the stream with EMPTY
 * content, which dsh-compaction-basic rejects cleanly ("summarization produced
 * no text summary content") — the same safe outcome as today's overflow.
 * @param ctx - plugin context (logger).
 * @param originalFetch - the unwrapped global fetch.
 * @param input - the original fetch input (url string or Request).
 * @param init - the (already rewritten) fetch init with the compaction body.
 * @param policy - the current policy including `chunking`.
 * @returns a synthetic Response, or undefined to forward the original request.
 */
export async function chunkedCompactionRescue(ctx, originalFetch, input, init, policy) {
  const cfg = policy?.chunking;
  if (cfg === null || typeof cfg !== "object") return undefined;
  if (typeof init?.body !== "string" || init.body.length === 0) return undefined;
  let body;
  try {
    body = JSON.parse(init.body);
  } catch {
    return undefined;
  }
  if (body === null || typeof body !== "object" || !Array.isArray(body.messages)) return undefined;
  const window = typeof body.model === "string" ? cfg.contextWindows[body.model] : undefined;
  if (typeof window !== "number" || !Number.isFinite(window) || window <= 0) return undefined; // unknown model: fail open
  const estimated = estimateBodyTokens(body);
  const callBudget = Math.floor(window * cfg.ratio);
  if (estimated <= callBudget) return undefined; // fits in one call: normal path
  // The final user message is the compaction instruction (layer 2 verified the
  // prefix); internal calls reuse it verbatim.
  const last = body.messages[body.messages.length - 1];
  const instructionText = messageText(last?.content);
  if (!instructionText.startsWith(COMPACTION_SIGNATURE)) return undefined;
  const rangeMessages = body.messages.slice(0, -1);
  // Leading system/developer messages are re-sent with EVERY internal call
  // (sliceMessages peels them into the prefix), so their cost comes out of
  // the per-slice budget too — otherwise every slice overflows by exactly the
  // size of the system prompt.
  let prefixEnd = 0;
  while (prefixEnd < rangeMessages.length) {
    const m = rangeMessages[prefixEnd];
    if (m !== null && typeof m === "object" && (m.role === "system" || m.role === "developer")) prefixEnd += 1;
    else break;
  }
  const prefixTokens = rangeMessages.slice(0, prefixEnd).reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  const sliceBudget = Math.max(callBudget - estimateTextTokens(instructionText) - prefixTokens - CHUNK_MARGIN_TOKENS, 4096);
  const sliced = sliceMessages(rangeMessages, sliceBudget);
  if (sliced === null || sliced.slices.length > cfg.maxChunks) {
    ctx.logger.warn(
      `qwen38-llamacpp-compaction-fix: compaction prompt (~${estimated} tokens) exceeds the chunk budget for "${body.model}" and cannot be split within maxChunks=${cfg.maxChunks}; forwarding the original request (it will likely overflow)`
    );
    return undefined;
  }
  const { prefix, slices } = sliced;
  const sliceTokens = slices.map((slice) => slice.reduce((sum, m) => sum + estimateMessageTokens(m), 0));
  ctx.logger.info(
    `qwen38-llamacpp-compaction-fix: compaction prompt (~${estimated} tokens) exceeds one call for "${body.model}" (window ${window}, budget ${callBudget}); running chunked map-reduce with ${slices.length} slices + merge`
  );
  const model = typeof body.model === "string" ? body.model : "unknown";
  const id = `chatcmpl-dshfix-${Math.random().toString(16).slice(2, 18)}`;
  const created = Math.floor(Date.now() / 1000);
  // Force POST: a bare url-string input would otherwise default to GET, and a
  // GET cannot carry the JSON bodies the internal calls send.
  const baseReq = new Request(input, { ...init, method: "POST" });

  const buildMergeMessages = (partials) => {
    const n = partials.length;
    return [
      {
        role: "user",
        content: `The original conversation was too large to summarize in a single pass. It was split into ${n} consecutive parts and each part was summarized separately. Below are the partial checkpoints, in order.`
      },
      ...partials.map((partial, i) => ({
        role: "user",
        content: `Partial checkpoint ${i + 1} of ${n}:\n<compacted-summary>\n${partial}\n</compacted-summary>`
      })),
      { role: "user", content: instructionText }
    ];
  };
  const estimateMergeInput = (partials) => buildMergeMessages(partials).reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  async function runMerge(messages) {
    const merged = await withRetry(() => internalCall(originalFetch, baseReq, buildInternalBody(body, messages, cfg.mergeMaxTokens)));
    if (merged.content.length === 0) throw new Error("merge produced no summary text");
    return merged.content;
  }
  async function mergePartials(partials, depth) {
    // Normally one flat merge fits. When the partials themselves would not fit
    // (small windows + many large partials), merge hierarchically: halves
    // first, then the two results. Bounded depth; a final overflow throws and
    // degrades to the safe empty-summary outcome.
    if (estimateMergeInput(partials) <= callBudget || depth >= 2) return runMerge(buildMergeMessages(partials));
    ctx.logger.info(`qwen38-llamacpp-compaction-fix: merge input (~${estimateMergeInput(partials)} tokens) exceeds one call; merging ${partials.length} partials hierarchically`);
    const mid = Math.ceil(partials.length / 2);
    const left = await mergePartials(partials.slice(0, mid), depth + 1);
    const right = await mergePartials(partials.slice(mid), depth + 2);
    return runMerge(buildMergeMessages([left, right]));
  }

  const work = (async () => {
    const partials = [];
    for (let i = 0; i < slices.length; i++) {
      ctx.logger.info(`qwen38-llamacpp-compaction-fix: summarizing slice ${i + 1}/${slices.length} (~${sliceTokens[i]} tokens)`);
      const chunkBody = buildInternalBody(body, [...prefix, ...slices[i], { role: "user", content: instructionText }], cfg.chunkMaxTokens);
      const result = await withRetry(() => internalCall(originalFetch, baseReq, chunkBody));
      if (result.content.length === 0) throw new Error(`slice ${i + 1}/${slices.length} produced no summary text`);
      partials.push(result.content);
    }
    ctx.logger.info(`qwen38-llamacpp-compaction-fix: merging ${partials.length} partial checkpoints into the final checkpoint`);
    return mergePartials(partials, 0);
  })();

  if (body.stream !== true) {
    // Non-streaming original: await the work and answer with plain JSON.
    try {
      const content = await work;
      ctx.logger.info(`qwen38-llamacpp-compaction-fix: chunked compaction complete (${content.length} chars)`);
      return jsonResponse(id, created, model, content);
    } catch (error) {
      // Fail to the same safe outcome as today's overflow: an empty summary,
      // which dsh-compaction-basic rejects and the surface is preserved.
      ctx.logger.error(`qwen38-llamacpp-compaction-fix: chunked compaction failed (${error?.message ?? error}); returning an empty summary so the harness keeps the conversation surface`);
      return jsonResponse(id, created, model, "");
    }
  }

  // Streaming original: synthetic SSE stream with keep-alive pings while the
  // slices run (pi-ai's stream idle timeout is 300s; a multi-minute rescue
  // must keep emitting).
  const state = { done: false, value: undefined, error: undefined };
  void work.then(
    (value) => {
      state.value = value;
      state.done = true;
    },
    (error) => {
      state.error = error;
      state.done = true;
    }
  );
  const generator = (async function* () {
    yield sseChunk(id, created, model, { role: "assistant", content: "" });
    let delay = FIRST_KEEPALIVE_MS;
    while (!state.done) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (!state.done) {
        yield ": keep-alive\n\n"; // SSE comment: valid, ignored by parsers
        delay = KEEPALIVE_MS;
      }
    }
    if (state.error !== undefined) {
      ctx.logger.error(`qwen38-llamacpp-compaction-fix: chunked compaction failed (${state.error?.message ?? state.error}); ending the stream with an empty summary so the harness keeps the conversation surface`);
      yield sseChunk(id, created, model, { content: "" }, "stop");
    } else {
      ctx.logger.info(`qwen38-llamacpp-compaction-fix: chunked compaction complete (${state.value.length} chars)`);
      yield sseChunk(id, created, model, { content: state.value });
      yield sseChunk(id, created, model, {}, "stop");
    }
    yield "data: [DONE]\n\n";
  })();
  return new Response(generator, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/**
 * Wrap the process-global `fetch` so compaction and session-title request
 * bodies receive the thinking-off wire fields (and, for compaction, the
 * sampling settings, the max_tokens floor, and — when the prompt no longer
 * fits one call — the chunked map-reduce rescue) at send time; only for bodies
 * whose `model` field is in the allow-list. The OpenAI SDK (pi-ai's transport)
 * resolves `fetch` from the global at client construction, and pi-ai builds a
 * fresh client per request, so wrapping here reaches every future LLM request
 * in this process. Non-matching requests pass through unmodified, and any
 * failure inside the gate leaves the request untouched. The wrapper is
 * installed once per process; a re-`apply` (profile reload in-process) only
 * rebinds the current policy source.
 */
function installSamplingFetch(ctx, readPolicy) {
  const g = globalThis;
  if (typeof g.fetch !== "function" || g.fetch[FETCH_WRAPPER_MARK] === true) {
    // Already wrapped (re-apply): just rebind the policy source.
    policySource = readPolicy;
    return;
  }
  const originalFetch = g.fetch;
  let applied = 0;
  let titleApplied = 0;
  const wrapper = async function llamacppCompactionSamplingFetch(input, init) {
    let policy;
    try {
      policy = policySource();
    } catch {
      policy = null;
    }
    if (policy !== null && typeof policy === "object") {
      let rewritten = false;
      try {
        rewritten = rewriteCompactionBody(init, policy);
      } catch {
        /* Never break LLM traffic: proceed with the untouched request. */
      }
      if (rewritten) {
        if (applied === 0) {
          const keys = (Array.isArray(policy.entries) ? policy.entries : []).map(([key]) => key).join(", ");
          const floorNote = policy.floor > 0 ? `; max_tokens floor ${policy.floor}` : "";
          ctx.logger.info(
            `qwen38-llamacpp-compaction-fix: rewriting compaction request bodies (thinking off${keys.length > 0 ? `, sampling: ${keys}` : ""}${floorNote})`
          );
        }
        applied += 1;
        // Layer 5: when the rewritten prompt no longer fits one call for this
        // model, rescue it with a chunked map-reduce instead of forwarding an
        // unforwardable request. Any throw fails open to the original path.
        try {
          const rescued = await chunkedCompactionRescue(ctx, originalFetch, input, init, policy);
          if (rescued !== undefined) return rescued;
        } catch {
          /* fail open: forward the original request */
        }
      } else {
        let titleRewritten = false;
        try {
          // The title gate is independent of the compaction gate: a body is
          // either the compaction call or a title call, never both.
          titleRewritten = rewriteTitleBody(init, policy);
        } catch {
          /* Never break LLM traffic: proceed with the untouched request. */
        }
        if (titleRewritten && titleApplied === 0) {
          ctx.logger.info(`qwen38-llamacpp-compaction-fix: rewriting session-title request bodies (thinking off)`);
        }
        if (titleRewritten) titleApplied += 1;
      }
    }
    return originalFetch.call(this, input, init);
  };
  wrapper[FETCH_WRAPPER_MARK] = true;
  g.fetch = wrapper;
  policySource = readPolicy;
}

/**
 * Pick the first level the model can express, in preference order: the
 * configured level, then `off`, then `low`.
 * @param configured - the configured (non-empty) effort.
 * @param offeredIds - effort ids the target model's reasoning metadata offers.
 * @returns the chosen effort id, or undefined when the model offers none.
 */
function chooseEffort(configured, offeredIds) {
  const seen = new Set();
  for (const candidate of [configured, OFF_EFFORT, FALLBACK_EFFORT]) {
    if (candidate.length === 0 || seen.has(candidate)) continue;
    seen.add(candidate);
    if (offeredIds.includes(candidate)) return candidate;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Feature 3 — manual compaction command (/qwen38-compact)
// ---------------------------------------------------------------------------

/** Command name users type in the composer. */
const MANUAL_COMPACT_COMMAND = "qwen38-compact";

/**
 * Resolve (building on first use) the dsh-compaction-basic engine class.
 * The import is dynamic and fail-soft: when the package cannot be resolved
 * from this deployment the command reports that instead of crashing plugin
 * load. Cached per process; the class is stateless, instances are not.
 * @returns a promise for `{ Engine }` or `{ error }`.
 */
let engineClassPromise = null;
function manualEngineClass() {
  if (engineClassPromise === null) {
    engineClassPromise = (async () => {
      let mod;
      try {
        mod = await import("@deepseek-ai/dsh-compaction-basic");
      } catch (error) {
        return { error: `dsh-compaction-basic is not resolvable from this deployment (${error?.message ?? error})` };
      }
      const Engine = mod.BasicCompactionEngine ?? mod.default;
      if (typeof Engine !== "function") {
        return { error: "dsh-compaction-basic did not export a BasicCompactionEngine class" };
      }
      return { Engine };
    })();
  }
  return engineClassPromise;
}

/** Friendly text for the known ManualCompactionError codes (duck-typed). */
function manualCompactFailureText(error) {
  const code = error && typeof error === "object" && typeof error.code === "string" ? error.code : "";
  switch (code) {
    case "busy": return "Agent 正忙(有进行中的轮次或排队任务),等它空闲后再试。";
    case "cancelled": return "压缩已取消,会话未改动。";
    case "changed": return "待压缩的历史在摘要完成前发生了变化,本次未生效;会话未改动,可重试。";
    case "summary": return "模型没有产出可用的摘要,本次未生效;会话未改动,可重试。";
    case "commit": return "压缩未能干净收尾,部分历史可能已变化;请检查会话状态后再试。";
    case "persistence": return "压缩完成但会话保存失败;请检查存储后重试。";
    default: return undefined;
  }
}

/**
 * Register the global `/qwen38-compact` command. The engine and the command
 * live inside an injected child context that declares exactly the services
 * the manual transaction needs (`commands`, `tokenMeter`, `sessions`; `llm`
 * is inherited from this plugin's own inject list). Global (not agent-scoped)
 * registration makes the command visible to every session — including
 * minimal-preset sessions, whose agents mount no command plugins at all.
 *
 * When any of the required services is absent from the deployment, cordis
 * never runs the callback: the plugin loads fine and simply has no command.
 * @param ctx - this plugin's context (must expose `inject`).
 */
function registerManualCompactCommand(ctx) {
  if (typeof ctx?.inject !== "function") return;
  try {
    ctx.inject(["commands", "tokenMeter", "sessions"], function qwen38ManualCompact(sctx) {
      const boot = (async () => {
        const resolved = await manualEngineClass();
        if (resolved.error !== undefined) return { error: resolved.error };
        try {
          // `auto: false` — the engine registers NO automatic hooks (no
          // pre-step pressure checks, no overflow-retry listeners); it exists
          // purely to execute manual transactions. Its summarization call goes
          // through `ctx.llm.stream({ purpose: "compaction" })`, so this
          // plugin's wire layers (thinking-off, sampling, max_tokens floor) and
          // the oversized-compaction chunked rescue apply exactly as they do
          // to the built-in engine.
          return { engine: new resolved.Engine(sctx, { auto: false }) };
        } catch (error) {
          return { error: `manual compaction engine construction failed (${error?.message ?? error})` };
        }
      })();
      try {
        sctx.effect(function* () {
          yield sctx.commands.register({
            name: MANUAL_COMPACT_COMMAND,
            description: "手动把当前会话历史压缩成摘要检查点(极简模式等无内置压缩引擎的会话也可用;超窗输入自动分片)",
            handler: async (invocation) => {
              const ready = await boot;
              if (ready.error !== undefined) {
                return { kind: "error", text: `无法执行手动压缩:${ready.error}` };
              }
              try {
                const result = await ready.engine.compactNow(invocation.agent, invocation.signal, invocation.commandId);
                if (result === null) {
                  return { kind: "success", text: "当前会话还没有可压缩的历史。" };
                }
                return {
                  kind: "success",
                  text: `已压缩 ${result.shadowedSeqs.length} 条历史(约 ${result.shadowedTokenCount} tokens)为摘要检查点。`,
                  sourceEventSeq: result.summarySeq
                };
              } catch (error) {
                if (invocation.signal?.aborted === true) return { kind: "error", text: "压缩已取消,会话未改动。" };
                const friendly = manualCompactFailureText(error);
                if (friendly !== undefined) return { kind: "error", text: friendly };
                throw error;
              }
            }
          });
        }, `${name}: manual compaction command`);
      } catch {
        /* duplicate registration (in-process re-apply): keep the first */
      }
    });
  } catch {
    /* inject unavailable or services missing: no command, plugin still loads */
  }
}

/**
 * Install the compaction policy on the `llm/stream` waterfall.
 * @param ctx - plugin context owning the listener and the settings wiring.
 * @param config - composition entry config (base layer under settings.yaml).
 */
function apply(ctx, config = {}) {
  // Resolve the entry config through the schema so a PARTIAL config (e.g. a
  // cordis.patch.yml row that sets only `models`) still gets every default.
  // When the settings service is mounted it replaces this source with its own
  // resolved scope (settings.yaml live overrides); when it is not, this is the
  // complete policy.
  let resolved = config;
  try {
    const r = Config["~standard"].validate(config);
    if (r !== null && typeof r === "object" && "value" in r) resolved = r.value;
  } catch {
    /* malformed entry: keep the raw config; policyOf stays defensive */
  }
  let current = () => resolved;
  const hooks = {
    setSource: (source) => {
      current = source;
    },
    onChange: () => {}
  };
  // New API (dsh-settings >= 0.1.3, e.g. source builds): the settings service
  // owns section installation; `ctx.inject` is optional — when no settings
  // service is mounted the callback never runs and the entry stays the source.
  let installed = false;
  if (typeof ctx?.inject === "function") {
    try {
      ctx.inject(["settings"], (sctx) => {
        if (typeof sctx?.settings?.installSection === "function") {
          sctx.settings.installSection(ctx, COMPACT_EFFORT_SETTINGS_NAMESPACE, Config, resolved, hooks);
          installed = true;
        }
      });
    } catch {
      /* fall through to the legacy surface */
    }
  }
  // Legacy API (dsh-settings 0.1.1-rc.x): package-level free function.
  if (!installed && typeof settingsApi?.installSettingsSection === "function") {
    try {
      const ns = typeof settingsApi.settingsNamespace === "function" ? settingsApi.settingsNamespace(COMPACT_EFFORT_SETTINGS_NAMESPACE) : COMPACT_EFFORT_SETTINGS_NAMESPACE;
      settingsApi.installSettingsSection(ctx, ns, Config, config, hooks);
    } catch {
      /* entry-only fallback */
    }
  }
  const readPolicy = () => policyOf(current());
  installSamplingFetch(ctx, readPolicy);
  const warned = new Set();
  ctx.on("llm/stream", (options, next) => {
    const cfg = current();
    const configured = typeof cfg.effort === "string" ? cfg.effort : DEFAULT_EFFORT;
    if (configured.length === 0) return next();
    if (options === null || typeof options !== "object" || typeof options.purpose !== "string") return next();
    const purposes = Array.isArray(cfg.purposes) && cfg.purposes.length > 0 ? cfg.purposes : DEFAULT_PURPOSES;
    if (!purposes.includes(options.purpose)) return next();
    // Model gate: only stamp calls targeting an allowed model.
    const models = Array.isArray(cfg.models) ? cfg.models : DEFAULT_MODELS;
    if (!models.includes(options.model)) return next();
    // An explicit per-call effort always wins over the plugin default.
    if (options.reasoningEffort !== undefined) return next();
    // A lazy async generator (not a promise): every llm/stream stage and
    // consumer deals in iterables, and the capability lookup + stamp happen
    // when the stream is first pumped — before the adapter dispatch starts.
    return (async function* () {
      let info;
      try {
        info = await ctx.llm.resolveModelInfo(options.provider, options.model, options.signal);
      } catch {
        // Capability lookup failed: leave the call untouched; its own
        // dispatch reports the real error.
        yield* next();
        return;
      }
      const offered = ((info ?? {}).reasoning?.efforts ?? []).map((effort) => effort.id);
      const chosen = chooseEffort(configured, offered);
      if (chosen !== undefined) {
        // The compaction engine builds a plain (unfrozen) options object and
        // the llm/stream default dispatch closes over this exact object, so
        // the in-place stamp reaches the adapter's wire mapping.
        try {
          options.reasoningEffort = chosen;
        } catch {
          /* frozen options: leave the model default in place */
        }
      } else if (!thinkingOffActive(readPolicy())) {
        // Only warn when NO layer can turn thinking off for this model: when
        // the wire-level gates are active, the HTTP layers handle it and the
        // missing declaration is expected (llama.cpp models rarely declare
        // reasoning efforts in settings.yaml).
        const key = `${options.provider}/${options.model}`;
        if (!warned.has(key)) {
          warned.add(key);
          ctx.logger.warn(
            `qwen38-llamacpp-compaction-fix: model "${key}" offers no expressible reasoning effort (configured "${configured}") and the wire thinking-off gates are disabled; compaction keeps the model default`
          );
        }
      }
      yield* next();
    })();
  });
  // Feature 3: the manual compaction command. Gated by config (live-reloaded:
  // a settings.yaml edit re-runs apply; duplicate registration is a no-op).
  const commandEnabled = resolved.command === null || typeof resolved.command !== "object"
    ? true
    : resolved.command.enabled !== false;
  if (commandEnabled) registerManualCompactCommand(ctx);
}

export { name, inject, Config, COMPACT_EFFORT_SETTINGS_NAMESPACE, apply, MANUAL_COMPACT_COMMAND };
