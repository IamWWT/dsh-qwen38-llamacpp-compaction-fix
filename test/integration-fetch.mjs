/**
 * Integration test: drives the REAL installed fetch wrapper end-to-end with a
 * stubbed upstream and the same config the bundle ships (cordis.patch.yml).
 * Verifies: oversized compaction -> chunked rescue (original body never
 * forwarded, thinking-off + sampling on internal calls, valid SSE back);
 * small compaction -> in-place rewrite + forward; title -> thinking off only;
 * disallowed model -> byte-identical pass-through.
 *
 *   node test/integration-fetch.mjs
 */
import { apply } from "../index.js";

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`);
  }
}

// Same values as cordis.patch.yml (keep in sync).
const ENTRY_CONFIG = {
  effort: "off",
  models: ["Qwen3.8-27B-GGUF"],
  sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0.0, presence_penalty: 1.5, repetition_penalty: 1.0 },
  maxTokensFloor: 16384,
  wireReasoning: "none",
  enableThinkingOff: true,
  chunking: {
    enabled: true,
    contextWindows: { "Qwen3.8-27B-GGUF": 262144 },
    chunkRatio: 0.7,
    chunkMaxTokens: 8192,
    mergeMaxTokens: 16384,
    maxChunks: 8
  }
};

const SIG = "You are now acting as a compaction engine for this AI coding assistant";
const TITLE = "Create a concise title for an AI coding-assistant session from the supplied human messages";

// Stub the REAL upstream BEFORE the plugin wraps it.
const upstreamCalls = [];
globalThis.fetch = async (input, init) => {
  const bodyText = typeof input === "string" ? init.body : await input.text();
  const body = JSON.parse(bodyText);
  upstreamCalls.push({ body, url: typeof input === "string" ? input : input.url });
  const isMerge = body.messages.some((m) => typeof m.content === "string" && m.content.includes("Partial checkpoint 1 of"));
  return new Response(
    JSON.stringify({
      id: "c",
      object: "chat.completion",
      created: 1,
      model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: isMerge ? "FINAL-CHECKPOINT" : `PARTIAL-${upstreamCalls.length}` }, finish_reason: "stop" }]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};

const logs = [];
apply(
  { logger: { info: (m) => logs.push(m), warn: (m) => logs.push(`W ${m}`), error: (m) => logs.push(`E ${m}`) }, on: () => {}, inject: () => {}, llm: {} },
  ENTRY_CONFIG
);

// --- oversized compaction (~405k tokens > 183.5k budget) -------------------
const messages = [{ role: "system", content: "sys" }];
for (let i = 0; i < 400; i++) {
  messages.push({ role: "user", content: `u${i}` + "u".repeat(2000) });
  messages.push({ role: "assistant", content: `a${i}` + "a".repeat(2000) });
}
messages.push({ role: "user", content: `${SIG}\n...` });
const res = await fetch("http://127.0.0.1:8880/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test" },
  body: JSON.stringify({ model: "Qwen3.8-27B-GGUF", stream: true, max_tokens: 1, messages })
});
const text = await res.text();
check("rescue: upstream calls = slices + merge (4)", upstreamCalls.length, 4);
check("rescue: original oversized body NOT forwarded", upstreamCalls.some((c) => c.body.messages.length === messages.length), false);
check("rescue: internal calls non-stream + thinking off", upstreamCalls.every((c) => c.body.stream === false && c.body.chat_template_kwargs?.enable_thinking === false && c.body.reasoning_effort === "none"), true);
check("rescue: sampling applied to internal calls", upstreamCalls.every((c) => c.body.temperature === 0.7 && c.body.top_k === 20), true);
check("rescue: SSE stream ends with [DONE]", text.trim().endsWith("[DONE]"), true);
check("rescue: final checkpoint delivered to caller", text.includes("FINAL-CHECKPOINT"), true);
check("rescue: logged the map-reduce plan", logs.some((l) => l.includes("running chunked map-reduce")), true);

// --- small compaction: in-place rewrite, single forward -------------------
await fetch("http://127.0.0.1:8880/v1/chat/completions", {
  method: "POST",
  body: JSON.stringify({ model: "Qwen3.8-27B-GGUF", stream: true, max_tokens: 1, messages: [{ role: "user", content: `${SIG}\n...` }] })
});
const fwd = upstreamCalls[upstreamCalls.length - 1].body;
check("small: forwarded as a single call", upstreamCalls.length === 5 && fwd.messages.length === 1, true);
check("small: thinking off + floor applied", [fwd.chat_template_kwargs?.enable_thinking, fwd.max_tokens], [false, 16384]);

// --- title: thinking off only, budget untouched ----------------------------
await fetch("http://127.0.0.1:8880/v1/chat/completions", {
  method: "POST",
  body: JSON.stringify({ model: "Qwen3.8-27B-GGUF", stream: true, max_tokens: 64, messages: [{ role: "system", content: `${TITLE}\n...` }, { role: "user", content: "hi" }] })
});
const t = upstreamCalls[upstreamCalls.length - 1].body;
check("title: thinking off written, max_tokens untouched", [t.chat_template_kwargs?.enable_thinking, t.reasoning_effort, t.max_tokens], [false, "none", 64]);

// --- disallowed model: byte-identical pass-through -------------------------
const before = JSON.stringify({ model: "gpt-4.1", stream: true, messages: [{ role: "user", content: SIG }] });
await fetch("http://127.0.0.1:8880/v1/chat/completions", { method: "POST", body: before });
check("disallowed model: byte-identical pass-through", JSON.stringify(upstreamCalls[upstreamCalls.length - 1].body), before);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
