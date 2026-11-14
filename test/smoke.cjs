/*
 * dsh-stl-viewer smoke test — no browser required.
 *
 *   node test/smoke.cjs
 *
 * Runs lib/client.js in a vm sandbox with a minimal React hook implementation and a
 * replaceable fetch, then asserts the module contract, the viewer registration, the
 * two parse paths (binary / ASCII) and the error paths.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const SRC = path.join(__dirname, '..', 'lib', 'client.js')
const FIXTURES = path.join(__dirname, 'fixtures')

// ---------------------------------------------------------------- React stub
// Just enough hooks to run the component outside a renderer: each hook takes a slot,
// effects are queued and flushed between frames.
let slots = []
let cursor = 0
let queued = []

const React = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat(9) }
  },
  useRef(init) {
    const i = cursor++
    if (!(i in slots)) slots[i] = { current: init }
    return slots[i]
  },
  useState(init) {
    const i = cursor++
    if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init
    return [
      slots[i],
      (next) => {
        slots[i] = typeof next === 'function' ? next(slots[i]) : next
      }
    ]
  },
  useEffect(fn, deps) {
    const i = cursor++
    const prev = slots[i]
    const changed =
      !prev ||
      !deps ||
      !prev.deps ||
      deps.length !== prev.deps.length ||
      deps.some((d, k) => d !== prev.deps[k])
    if (changed) {
      slots[i] = { deps }
      queued.push(fn)
    }
  },
  useMemo(fn) {
    cursor++
    return fn()
  },
  useCallback(fn) {
    cursor++
    return fn
  }
}

// ---------------------------------------------------------------- sandbox
let fetchImpl = () => Promise.reject(new Error('fetch not stubbed'))
let entry = null
const noop = () => {}

const sandbox = {
  console,
  Math,
  Date,
  JSON,
  Promise,
  DataView,
  Uint8Array,
  Uint32Array,
  Float32Array,
  ArrayBuffer,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
  fetch: (url, opts) => fetchImpl(url, opts),
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: noop,
  performance: { now: () => Date.now() },
  ResizeObserver: function () {
    this.observe = noop
    this.disconnect = noop
    this.unobserve = noop
  }
}
sandbox.window = {
  __ModuleLoader__: {
    load(d) {
      entry = d
    }
  },
  addEventListener: noop,
  removeEventListener: noop,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: noop,
  devicePixelRatio: 1,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  getComputedStyle: () => ({ getPropertyValue: () => '' })
}
// Pin the UI language: the assertions below read the English strings.
sandbox.document = {
  documentElement: { getAttribute: (name) => (name === 'lang' ? 'en-US' : null) },
  body: { classList: { contains: () => false } },
  createElement: () => ({ style: {}, setAttribute: noop }),
  addEventListener: noop,
  removeEventListener: noop
}
sandbox.navigator = { language: 'en-US', languages: ['en-US'] }
sandbox.globalThis = sandbox

const context = vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(SRC, 'utf8'), context, { filename: SRC })

const failures = []
function check(name, cond, detail) {
  if (cond) {
    console.log('  ok   ' + name)
  } else {
    failures.push(name)
    console.log('  FAIL ' + name + (detail ? ' → ' + detail : ''))
  }
}

// ---------------------------------------------------------------- module contract
console.log('\n[1] module contract')
check('loader entry captured', !!entry)
check("id is 'dsh-stl-viewer'", entry && entry.id === 'dsh-stl-viewer', entry && entry.id)
const mod = entry.factory((spec) => {
  if (spec === 'react') return React
  throw new Error('unexpected require: ' + spec)
})
check("exports name 'dsh-stl-viewer'", mod && mod.name === 'dsh-stl-viewer', mod && mod.name)
check('exports apply()', mod && typeof mod.apply === 'function')

// ---------------------------------------------------------------- registration
console.log('\n[2] betterSidebar registration')
const viewers = []
const icons = []
const teardown = mod.apply({
  betterSidebar: {
    registerFileViewer(d) {
      viewers.push(d)
      return noop
    },
    registerFileIcon(d) {
      icons.push(d)
      return noop
    }
  }
})
check('registered exactly one viewer', viewers.length === 1, String(viewers.length))
const viewer = viewers[0] || {}
check(
  "exts contains 'stl'",
  Array.isArray(viewer.exts) && viewer.exts.indexOf('stl') >= 0,
  JSON.stringify(viewer.exts)
)
check("fetchStrategy is 'mediaUrl'", viewer.fetchStrategy === 'mediaUrl', viewer.fetchStrategy)
check('priority beats the builtins', typeof viewer.priority === 'number' && viewer.priority > 0, String(viewer.priority))
check('component is a function', typeof viewer.component === 'function')
check('title() is non-empty', typeof viewer.title === 'function' && !!viewer.title())
const iconNode = typeof viewer.icon === 'function' ? viewer.icon(16) : viewer.icon
check('icon(16) renders', !!iconNode)
check('registered a .stl file icon', icons.length === 1 && icons[0].exts.indexOf('stl') >= 0)
check('apply() returns a teardown', typeof teardown === 'function')

// Re-register for the render cases: the teardown above unregistered the service stub's
// disposer, not the descriptor, so the captured viewer is still valid.
viewers.length = 0

// ---------------------------------------------------------------- render helpers
const tick = () => new Promise((r) => setTimeout(r, 0))

async function render(props) {
  slots = []
  queued = []
  cursor = 0
  let tree = viewer.component(props)
  for (let frame = 0; frame < 6; frame++) {
    const batch = queued
    queued = []
    cursor = 0
    for (const fn of batch) {
      try {
        fn()
      } catch (e) {
        check('effects never throw', false, e && e.message)
      }
    }
    await tick()
    await tick()
    cursor = 0
    tree = viewer.component(props)
  }
  return tree
}

function textOf(node) {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node === 'object' && node.children) return textOf(node.children)
  return ''
}

const bytesOf = (buf) => new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))

function serveBinary(buf) {
  return () =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    })
}

// ---------------------------------------------------------------- cases
;(async () => {
  console.log('\n[3] binary STL — fixture cube, 12 facets')
  const cube = fs.readFileSync(path.join(FIXTURES, 'cube.stl'))
  fetchImpl = serveBinary(cube)
  let text = textOf(await render({ mediaUrl: 'http://x/cube.stl', path: 'cube.stl', visible: true }))
  check('no error overlay', text.indexOf('Retry') < 0, text.slice(0, 160))
  check('facet count is 12', /\b12\s+triangles/.test(text), text.slice(0, 200))
  check('size readout is 20 × 20 × 20', /20(\.0)?\s*×\s*20(\.0)?\s*×\s*20(\.0)?/.test(text), text.slice(0, 200))
  check('reset button present', text.indexOf('Reset view') >= 0, text.slice(0, 200))
  check('gesture hint present', /orbit|zoom/i.test(text), text.slice(0, 240))

  console.log('\n[4] ASCII STL — single triangle, 10 × 20')
  const ascii = [
    'solid tri',
    '  facet normal 0 0 1',
    '    outer loop',
    '      vertex 0 0 0',
    '      vertex 10 0 0',
    '      vertex 0 20 0',
    '    endloop',
    '  endfacet',
    'endsolid tri',
    ''
  ].join('\n')
  fetchImpl = () => Promise.resolve({ ok: true, status: 200, text: async () => ascii, arrayBuffer: async () => new TextEncoder().encode(ascii).buffer })
  text = textOf(await render({ content: ascii, path: 'tri.stl', visible: true }))
  check('no error overlay', text.indexOf('Retry') < 0, text.slice(0, 160))
  check('facet count is 1', /\b1\s+triangles/.test(text), text.slice(0, 200))
  check('size carries both edges', /10(\.0)?/.test(text) && /20(\.0)?/.test(text), text.slice(0, 240))

  console.log('\n[5] garbage bytes')
  text = textOf(await render({ content: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), path: 'junk.stl' }))
  check('shows Retry', text.indexOf('Retry') >= 0, text.slice(0, 160))

  console.log('\n[6] empty file')
  text = textOf(await render({ content: new Uint8Array(0), path: 'empty.stl' }))
  check('shows Retry', text.indexOf('Retry') >= 0, text.slice(0, 160))

  console.log('\n[7] failed fetch')
  const broken = fs.readFileSync(path.join(FIXTURES, 'broken.stl'))
  fetchImpl = serveBinary(broken)
  text = textOf(await render({ mediaUrl: 'http://x/broken.stl', path: 'broken.stl', visible: true }))
  check('shows Retry', text.indexOf('Retry') >= 0, text.slice(0, 160))

  console.log(
    '\nresult: ' +
      (failures.length ? failures.length + ' failed → ' + failures.join('; ') : 'all passed')
  )
  process.exit(failures.length ? 1 : 0)
})().catch((e) => {
  console.error('harness error:', e)
  process.exit(2)
})
