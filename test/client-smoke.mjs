/**
 * Client-half smoke test: loads client.js in a VM with a stubbed browser
 * module loader, drives the Cordis plugin surface (apply → slot registration),
 * renders the card with a minimal React renderer, and exercises edit/save/
 * reset/discard against a fake settings scope.
 *
 * Run: node test/client-smoke.mjs
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const ROOT = new URL('..', import.meta.url).pathname

// ---------------------------------------------------------------------------
// Minimal React stand-in (createElement + one-shot function-component render).
// The card uses no real hooks — useQwen38Card is a plain selector prop.
// ---------------------------------------------------------------------------
function createElement(type, props, ...children) {
  const flat = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false)
  return { type, props: { ...(props ?? {}), ...(flat.length > 0 ? { children: flat.length === 1 ? flat[0] : flat } : {}) } }
}

function render(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(render).join('')
  const { type, props } = node
  if (typeof type === 'function') return render(type(props))
  const SKIP = new Set(['children', 'style', 'onChange', 'onClick', 'disabled', 'aria-invalid'])
  const attrs = Object.entries(props ?? {})
    .filter(([k]) => !SKIP.has(k) && typeof props[k] !== 'function')
    .map(([k, v]) => ` ${k}="${String(v)}"`)
    .join('')
  return `<${type}${attrs}>${render(props.children)}</${type}>`
}

const ReactStub = { createElement }

// Themed-atom stand-ins (shape-compatible with the real primitives).
const PrimitivesStub = {
  Button: ({ children, ...rest }) => createElement('button', rest, children),
  Input: (props) => createElement('input', props),
}

// dsh-client-store stand-in: the three methods the controller uses.
function createSnapshotStore(init) {
  let state = init
  const listeners = new Set()
  return {
    getSnapshot: () => state,
    set: (next) => { state = next; for (const l of [...listeners]) l() },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

// ---------------------------------------------------------------------------
// Fake Cordis browser context + settings scope.
// ---------------------------------------------------------------------------
const BASE_VALUE = {
  effort: 'off',
  models: ['Qwen3.8-27B-GGUF'],
  sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0.0, presence_penalty: 1.5, repetition_penalty: 1.0 },
  maxTokensFloor: 16384,
  wireReasoning: 'none',
  enableThinkingOff: true,
  chunking: { enabled: true, contextWindows: { 'Qwen3.8-27B-GGUF': 262144 }, chunkRatio: 0.7, chunkMaxTokens: 8192, mergeMaxTokens: 16384, maxChunks: 8 },
}

let userValue = { maxTokensFloor: 20000 } // a pre-existing user override
const mutateCalls = []

/** Deep-merge the user layer over the base (the real scope serves merged values). */
function merged() {
  const out = JSON.parse(JSON.stringify(BASE_VALUE))
  for (const [key, val] of Object.entries(userValue)) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && typeof out[key] === 'object' && out[key] !== null) {
      Object.assign(out[key], JSON.parse(JSON.stringify(val)))
    } else {
      out[key] = JSON.parse(JSON.stringify(val))
    }
  }
  return out
}

const fakeScope = {
  getSnapshot: () => ({ status: 'ready', value: merged(), base: BASE_VALUE, user: userValue, revision: 3, writable: true, mode: 'host' }),
  subscribe: () => () => {},
  async mutate(ops, expectedRevision) {
    mutateCalls.push({ ops, expectedRevision })
    // Apply the ops to the user layer so a re-render reflects them.
    for (const op of ops) {
      const target = op.op === 'set' ? op.value : undefined
      let cur = userValue
      for (let i = 0; i < op.path.length - 1; i += 1) {
        if (typeof cur[op.path[i]] !== 'object' || cur[op.path[i]] === null) cur[op.path[i]] = {}
        cur = cur[op.path[i]]
      }
      const last = op.path[op.path.length - 1]
      if (op.op === 'set') cur[last] = target
      else delete cur[last]
    }
  },
}

const localeRegisters = []
const slotEntries = []
let effects = 0
const fakeCtx = {
  effect: (fn, _label) => { effects += 1; fn() },
  locale: {
    register: (ns, dict) => { localeRegisters.push({ ns, dict }) },
    bind: () => (key) => key,
  },
  settingsScope: {
    bind: (spec) => {
      assert.equal(spec.namespace, 'qwen38-llamacpp-compaction-fix')
      return fakeScope
    },
  },
  slots: {
    inject: (_slot, cb) => cb(),
    register: (options, component) => { slotEntries.push({ options, component }) },
  },
}

// ---------------------------------------------------------------------------
// Load client.js through the stubbed module loader.
// ---------------------------------------------------------------------------
const loaded = []
const sandbox = {
  window: { __ModuleLoader__: { load: (spec) => loaded.push(spec) } },
  console,
}
vm.createContext(sandbox)
vm.runInContext(readFileSync(`${ROOT}client.js`, 'utf8'), sandbox, { filename: 'client.js' })

assert.equal(loaded.length, 1, 'exactly one module registered')
assert.equal(loaded[0].id, 'dsh-qwen38-llamacpp-compaction-fix')

const plugin = loaded[0].factory((specifier) => {
  if (specifier === 'react') return ReactStub
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return PrimitivesStub
  if (specifier === '@deepseek-ai/dsh-client-store') return { createSnapshotStore }
  throw new Error(`unexpected require: ${specifier}`)
})

assert.equal(plugin.name, 'qwen38-llamacpp-compaction-fix')
assert.deepEqual([...plugin.inject].sort(), ['locale', 'settingsScope', 'slots'])

// ---------------------------------------------------------------------------
// apply(): locale + slot registration.
// ---------------------------------------------------------------------------
plugin.apply(fakeCtx)
assert.equal(effects, 1)
assert.equal(localeRegisters.length, 1)
assert.equal(localeRegisters[0].ns, 'qwen38-llamacpp-compaction-fix')
for (const lang of ['zh', 'en']) {
  const dict = localeRegisters[0].dict[lang]
  assert.ok(dict && typeof dict.title === 'string' && dict.title.length > 0, `locale ${lang} has title`)
  for (const key of ['modelsLabel', 'contextWindowLabel', 'enableThinkingOffLabel', 'wireReasoningLabel', 'maxTokensFloorLabel', 'rescueLabel', 'advancedTitle', 'save', 'discard', 'overridden', 'reset', 'invalidNumber', 'saveFailed']) {
    assert.ok(typeof dict[key] === 'string' && dict[key].length > 0, `locale ${lang} has ${key}`)
  }
}

assert.equal(slotEntries.length, 1, 'one card registered')
const entry = slotEntries[0]
assert.equal(entry.options.name, 'settings.plugin.item')
assert.equal(entry.options.key, 'qwen38-llamacpp-compaction-fix')
assert.equal(entry.options.locale, 'qwen38-llamacpp-compaction-fix')
assert.equal(typeof entry.component, 'function')

const face = entry.options.inject()
assert.ok(face.hooks.qwen38Card, 'face exposes the card store hook')
for (const fn of ['edit', 'resetField', 'save', 'discard']) assert.equal(typeof face[fn], 'function')

// ---------------------------------------------------------------------------
// Render pass 1: base value + one user override.
// ---------------------------------------------------------------------------
const t = (key) => localeRegisters[0].dict.zh[key]
let props = { t, useQwen38Card: (sel) => sel(face.hooks.qwen38Card.getSnapshot()) }

let html = render(entry.component(props))
assert.match(html, /Qwen3\.8 llama\.cpp 压缩修复/, 'card title renders')
assert.match(html, /Qwen3\.8-27B-GGUF/, 'model id renders')
assert.match(html, /262144/, 'context window renders')
assert.match(html, /20000/, 'user-overridden maxTokensFloor renders (not the base 16384)')
assert.match(html, /已覆盖默认值/, 'override badge on the overridden field')
assert.ok(!/maxTokensFloor" value="16384"/.test(html), 'base value hidden where user override exists')

// ---------------------------------------------------------------------------
// Edit + save: staged text becomes a set op with the nested path.
// ---------------------------------------------------------------------------
face.edit('maxTokensFloor', '32768')
props = { t, useQwen38Card: (sel) => sel(face.hooks.qwen38Card.getSnapshot()) }
html = render(entry.component(props))
assert.match(html, /32768/, 'edited value renders before save')

face.edit('chunkRatio', '0.9')
await face.save()
// vm-realm objects have a foreign prototype; normalize before comparing.
const norm = (v) => JSON.parse(JSON.stringify(v))
assert.equal(mutateCalls.length, 1)
const ops = norm(mutateCalls[0].ops)
assert.deepEqual(ops, [
  { op: 'set', path: ['maxTokensFloor'], value: 32768 },
  { op: 'set', path: ['chunking', 'chunkRatio'], value: 0.9 },
], 'save emits one op per staged field with correct paths')
assert.equal(mutateCalls[0].expectedRevision, 3)

// ---------------------------------------------------------------------------
// Invalid number blocks the save.
// ---------------------------------------------------------------------------
face.edit('maxTokensFloor', 'abc')
props = { t, useQwen38Card: (sel) => sel(face.hooks.qwen38Card.getSnapshot()) }
html = render(entry.component(props))
assert.match(html, /<button[^>]*>保存<\/button>/, 'save button present while dirty')
await face.save()
assert.equal(mutateCalls.length, 1, 'invalid field blocks the save')

// resetField stages an unset (the built-in CardForm semantics): the field shows the
// base value, loses its override badge, and saving emits an unset op.
face.resetField('maxTokensFloor')
props = { t, useQwen38Card: (sel) => sel(face.hooks.qwen38Card.getSnapshot()) }
html = render(entry.component(props))
assert.match(html, /maxTokensFloor" value="16384"/, 'reset shows the base value')
assert.ok(/<button[^>]*>保存<\/button>/.test(html), 'reset stages a pending unset (save appears)')
await face.save()
const resetOps = norm(mutateCalls.at(-1).ops)
assert.deepEqual(resetOps, [{ op: 'unset', path: ['maxTokensFloor'] }], 'reset save emits an unset op')
// The fake scope applied the unset: only the chunkRatio override badge remains.
props = { t, useQwen38Card: (sel) => sel(face.hooks.qwen38Card.getSnapshot()) }
html = render(entry.component(props))
assert.equal((html.match(/已覆盖默认值/g) || []).length, 1, 'override badge count drops after unset')

// discard drops all staged edits.
face.edit('chunkRatio', '0.5')
face.discard()
props = { t, useQwen38Card: (sel) => sel(face.hooks.qwen38Card.getSnapshot()) }
html = render(entry.component(props))
assert.ok(!/<button[^>]*>保存<\/button>/.test(html), 'no save button after discard')

// ---------------------------------------------------------------------------
// Boolean field + clear semantics.
// ---------------------------------------------------------------------------
face.edit('enableThinkingOff', 'false')
face.edit('wireReasoning', '')
await face.save()
const lastOps = norm(mutateCalls.at(-1).ops)
assert.deepEqual(lastOps, [
  { op: 'set', path: ['enableThinkingOff'], value: false },
  { op: 'unset', path: ['wireReasoning'] },
], 'checkbox writes a boolean; blank text unsets the field')

// ---------------------------------------------------------------------------
// Context-window path follows the first model id.
// ---------------------------------------------------------------------------
face.edit('models', 'NewModel-42, Other')
await face.save()
const modelOps = norm(mutateCalls.at(-1).ops)
assert.deepEqual(modelOps, [{ op: 'set', path: ['models'], value: ['NewModel-42', 'Other'] }])

console.log('client-smoke: all assertions passed')
