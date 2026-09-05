/**
 * Gating smoke test for dsh-qwen38-llamacpp-compaction-fix.
 *
 * Run from this directory (a `node_modules` symlink into a tree that provides
 * @deepseek-ai/schemastery + @deepseek-ai/dsh-settings must be resolvable —
 * e.g. the profile's node_modules, or the global dsh install):
 *
 *   node test/smoke.mjs
 */
import {
  COMPACTION_SIGNATURE,
  TITLE_SIGNATURE,
  applyThinkingOff,
  buildInternalBody,
  estimateBodyTokens,
  estimateMessageTokens,
  estimateTextTokens,
  rewriteCompactionBody,
  rewriteTitleBody,
  sliceMessages,
  truncateMessageToBudget
} from "../index.js";

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

const POLICY = {
  entries: [
    ["temperature", 0.7],
    ["top_p", 0.8],
    ["top_k", 20],
    ["min_p", 0.0],
    ["presence_penalty", 1.5],
    ["repetition_penalty", 1.0]
  ],
  floor: 16384,
  wireReasoning: "none",
  enableThinkingOff: true,
  models: ["Qwen3.8-27B-GGUF"],
  chunking: null
};

function compactionInit(model, { maxTokens = 1, extraMessages = [] } = {}) {
  const body = {
    model,
    stream: true,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: "You are a coding assistant." },
      ...extraMessages,
      { role: "user", content: `please do something` },
      { role: "assistant", content: "done" },
      { role: "user", content: `${COMPACTION_SIGNATURE}\nCondense the conversation ABOVE...` }
    ]
  };
  return { body: JSON.stringify(body) };
}

function titleInit(model, maxTokens = 64) {
  const body = {
    model,
    stream: true,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: `${TITLE_SIGNATURE}\n...` },
      { role: "user", content: "first human message" }
    ]
  };
  return { body: JSON.stringify(body) };
}

console.log("compaction gate:");
{
  const init = compactionInit("Qwen3.8-27B-GGUF");
  check("allowed model is rewritten", rewriteCompactionBody(init, POLICY), true);
  const body = JSON.parse(init.body);
  check("  enable_thinking merged", body.chat_template_kwargs?.enable_thinking, false);
  check("  reasoning_effort written", body.reasoning_effort, "none");
  check("  sampling applied", [body.temperature, body.top_p, body.top_k, body.min_p, body.presence_penalty, body.repetition_penalty], [0.7, 0.8, 20, 0.0, 1.5, 1.0]);
  check("  max_tokens raised to floor", body.max_tokens, 16384);

  const init2 = compactionInit("gpt-4.1");
  check("disallowed model untouched", [rewriteCompactionBody(init2, POLICY), init2.body.length > 0 && !init2.body.includes("enable_thinking")], [false, true]);

  const init3 = { body: JSON.stringify({ stream: true, messages: [{ role: "user", content: COMPACTION_SIGNATURE }] }) };
  check("missing model field untouched", rewriteCompactionBody(init3, POLICY), false);

  check("empty models list disables policy", rewriteCompactionBody(compactionInit("Qwen3.8-27B-GGUF"), { ...POLICY, models: [] }), false);

  const quoted = compactionInit("Qwen3.8-27B-GGUF", {
    extraMessages: [{ role: "user", content: COMPACTION_SIGNATURE + " (quoted in an earlier turn)" }]
  });
  check("signature quoted mid-conversation still rewrites the real call", rewriteCompactionBody(quoted, POLICY), true);

  const trailing = { body: JSON.stringify({ model: "Qwen3.8-27B-GGUF", messages: [{ role: "user", content: `see docs:\n${COMPACTION_SIGNATURE}` }] }) };
  check("last user message NOT starting with the signature untouched", rewriteCompactionBody(trailing, POLICY), false);

  const merged = { body: JSON.stringify({ model: "Qwen3.8-27B-GGUF", chat_template_kwargs: { other_kwarg: 1 }, messages: [{ role: "user", content: COMPACTION_SIGNATURE }] }) };
  check("existing chat_template_kwargs preserved on merge", [rewriteCompactionBody(merged, POLICY), JSON.parse(merged.body).chat_template_kwargs], [true, { other_kwarg: 1, enable_thinking: false }]);

  const onlySampling = { ...POLICY, wireReasoning: "", enableThinkingOff: false };
  const samplingOnly = compactionInit("Qwen3.8-27B-GGUF");
  check("sampling/floor still apply when thinking-off gates are off", [rewriteCompactionBody(samplingOnly, onlySampling), JSON.parse(samplingOnly.body).temperature, JSON.parse(samplingOnly.body).max_tokens, "chat_template_kwargs" in JSON.parse(samplingOnly.body)], [true, 0.7, 16384, false]);
}

console.log("title gate:");
{
  const init = titleInit("Qwen3.8-27B-GGUF");
  check("allowed model is rewritten", rewriteTitleBody(init, POLICY), true);
  const body = JSON.parse(init.body);
  check("  enable_thinking merged", body.chat_template_kwargs?.enable_thinking, false);
  check("  reasoning_effort written", body.reasoning_effort, "none");
  check("  title max_tokens left alone", body.max_tokens, 64);

  const init2 = titleInit("Gemma4-12B");
  check("disallowed model untouched", rewriteTitleBody(init2, POLICY), false);

  const userRole = { body: JSON.stringify({ model: "Qwen3.8-27B-GGUF", messages: [{ role: "user", content: TITLE_SIGNATURE }] }) };
  check("signature in a user-role message untouched (must be system/developer)", rewriteTitleBody(userRole, POLICY), false);

  const disabled = { ...POLICY, wireReasoning: "", enableThinkingOff: false };
  check("both gates off -> untouched", rewriteTitleBody(titleInit("Qwen3.8-27B-GGUF"), disabled), false);
}

console.log("estimation:");
{
  const ascii = estimateTextTokens("a".repeat(400));
  const cjk = estimateTextTokens("中".repeat(100));
  check("ascii ~4 chars/token", ascii, 100);
  check("cjk ~1 char/token (conservative)", cjk, 100);
  check("cjk denser than ascii for equal length", estimateTextTokens("中".repeat(400)) > estimateTextTokens("a".repeat(400)), true);
  const withTools = { messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "x", description: "d".repeat(400) } }] };
  check("body estimate includes tools", estimateBodyTokens(withTools) > estimateBodyTokens({ messages: [{ role: "user", content: "hi" }] }), true);
}

console.log("slicing:");
{
  const big = (n) => ({ role: "user", content: `message ${n}: ` + "x".repeat(n * 1000) });
  const messages = [
    { role: "system", content: "sys" },
    { role: "developer", content: "dev" },
    big(1),
    { role: "assistant", content: "a1", tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "tool result" },
    big(2),
    big(3)
  ];
  const sliced = sliceMessages(messages, 600);
  check("leading system/developer peeled into prefix", sliced.prefix.map((m) => m.role), ["system", "developer"]);
  check("all non-prefix messages covered exactly once in order", sliced.slices.flat().map((m) => (typeof m.content === "string" ? m.content.slice(0, 12) : m.role)), [
    "message 1: x",
    "a1",
    "tool result",
    "message 2: x",
    "message 3: x"
  ]);
  check("no slice starts with a tool message", sliced.slices.some((s) => s[0]?.role === "tool"), false);
  check("assistant tool_calls kept with its tool result", sliced.slices.some((s) => s.includes(messages[3]) && s.includes(messages[4])), true);
  check("every slice fits the budget (or holds an orphan-guard overflow)", sliced.slices.every((s) => s.reduce((sum, m) => sum + estimateMessageTokens(m), 0) <= 600 || s.some((m) => m.role === "tool")), true);

  const truncated = truncateMessageToBudget({ role: "user", content: "y".repeat(100000) }, 200);
  check("oversized single message truncated below budget", estimateMessageTokens(truncated) <= 200, true);
  check("truncation marker present", truncated.content.includes("truncated"), true);
}

console.log("internal call bodies:");
{
  const source = {
    model: "Qwen3.8-27B-GGUF",
    stream: true,
    max_tokens: 16384,
    temperature: 0.7,
    chat_template_kwargs: { enable_thinking: false },
    reasoning_effort: "none",
    tools: [{ type: "function" }],
    messages: []
  };
  const out = buildInternalBody(source, [{ role: "user", content: "slice" }], 8192);
  check("model kept", out.model, "Qwen3.8-27B-GGUF");
  check("thinking-off fields kept", [out.chat_template_kwargs?.enable_thinking, out.reasoning_effort], [false, "none"]);
  check("sampling kept", out.temperature, 0.7);
  check("tools dropped", "tools" in out, false);
  check("stream forced false", out.stream, false);
  check("max_tokens set to the internal cap", out.max_tokens, 8192);
  check("messages replaced", out.messages, [{ role: "user", content: "slice" }]);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
