/**
 * End-to-end test of the oversized-compaction rescue (feature 2) with a mock
 * transport: verifies the slice fan-out, the merge call, thinking-off fields
 * on internal calls, and the synthetic SSE stream shape.
 *
 *   node test/rescue-e2e.mjs
 */
import { COMPACTION_SIGNATURE, chunkedCompactionRescue } from "../index.js";

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

const logs = [];
const ctx = { logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) } };

// --- build a compaction body whose prompt is far bigger than the window ----
const INSTRUCTION = `${COMPACTION_SIGNATURE}\nCondense the conversation ABOVE into a structured checkpoint...`;
const messages = [{ role: "system", content: "You are a coding assistant." }];
for (let i = 0; i < 30; i++) {
  messages.push({ role: "user", content: `turn ${i} user: ` + "u".repeat(2000) });
  messages.push({ role: "assistant", content: `turn ${i} assistant: ` + "a".repeat(2000) });
}
messages.push({ role: "user", content: INSTRUCTION });

const baseBody = {
  model: "Qwen3.8-27B-GGUF",
  stream: true,
  max_tokens: 16384,
  temperature: 0.7,
  top_p: 0.8,
  chat_template_kwargs: { enable_thinking: false },
  reasoning_effort: "none",
  tools: [{ type: "function", function: { name: "bash", description: "run a command" } }],
  messages
};

// --- mock transport ---------------------------------------------------------
const calls = [];
async function mockFetch(req) {
  const body = JSON.parse(await req.text());
  calls.push(body);
  const isMerge = body.messages.some((m) => typeof m.content === "string" && m.content.includes("Partial checkpoint 1 of"));
  const content = isMerge ? "# MERGED CHECKPOINT\n## Primary Request and Intent\n- merged" : `# PARTIAL ${calls.length}`;
  return new Response(
    JSON.stringify({
      id: "chatcmpl-mock",
      object: "chat.completion",
      created: 1,
      model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

const policy = {
  entries: [],
  floor: 0,
  wireReasoning: "",
  enableThinkingOff: false, // rescue path is independent of the thinking-off gates
  models: ["Qwen3.8-27B-GGUF"],
  chunking: {
    contextWindows: { "Qwen3.8-27B-GGUF": 20000 },
    ratio: 0.7,
    chunkMaxTokens: 512,
    mergeMaxTokens: 1024,
    maxChunks: 8
  }
};

const init = { body: JSON.stringify(baseBody) };
const res = await chunkedCompactionRescue(ctx, mockFetch, "http://127.0.0.1:8880/v1/chat/completions", init, policy);
check("rescue committed (synthetic response returned)", res instanceof Response, true);

// Consume the synthetic stream first: it is what drives the background work.
const text = await res.text();

// --- inspect the internal calls --------------------------------------------
// window 20000 x 0.7 = 14000 call budget; minus instruction + margin the
// slice budget is ~12900 tokens; each turn message is ~505 tokens, so the
// 60-message range splits into 3 slices (+1 merge call).
check("internal calls = 3 slices + 1 merge", calls.length, 4);
for (const [i, c] of calls.entries()) {
  check(`call ${i}: stream forced false`, c.stream, false);
  check(`call ${i}: tools dropped`, "tools" in c, false);
  check(`call ${i}: thinking-off fields carried over`, [c.chat_template_kwargs?.enable_thinking, c.reasoning_effort], [false, "none"]);
  check(`call ${i}: sampling carried over`, c.temperature, 0.7);
  check(`call ${i}: final user message is the instruction`, typeof c.messages[c.messages.length - 1].content === "string" && c.messages[c.messages.length - 1].content.startsWith(COMPACTION_SIGNATURE), true);
}
const lastCall = calls[calls.length - 1];
check("last call is the merge (carries partial checkpoints)", lastCall.messages.some((m) => m.content.includes("<compacted-summary>")), true);

// --- inspect the synthetic SSE stream ---------------------------------------
const lines = text.split("\n").filter((l) => l.length > 0);
check("content-type is event-stream", res.headers.get("content-type"), "text/event-stream");
check("ends with [DONE]", lines[lines.length - 1], "data: [DONE]");
const dataLines = lines.filter((l) => l.startsWith("data: ") && l !== "data: [DONE]").map((l) => JSON.parse(l.slice(6)));
check("first chunk carries the role delta", dataLines[0]?.choices?.[0]?.delta?.role, "assistant");
const contentChunks = dataLines.filter((d) => typeof d.choices?.[0]?.delta?.content === "string" && d.choices[0].delta.content.length > 0);
check("exactly one content chunk with the merged checkpoint", [contentChunks.length, contentChunks[0]?.choices?.[0]?.delta?.content], [1, "# MERGED CHECKPOINT\n## Primary Request and Intent\n- merged"]);
const finishChunk = dataLines.find((d) => d.choices?.[0]?.finish_reason === "stop");
check("a stop finish chunk exists", finishChunk !== undefined, true);
check("model field preserved on chunks", dataLines[0].model, "Qwen3.8-27B-GGUF");

console.log(`\ninternal calls made: ${calls.length}`);
for (const l of logs) console.log(`  log: ${l}`);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
