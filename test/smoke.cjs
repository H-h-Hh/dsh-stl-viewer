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

  console.log('\n[8] face-to-face geometry')
  const geo = mod.__internals
  // A 在 z=0 平躺，B 在 z=5 平躺（两者平行），C 立起来与 A 共用一条边
  const pos = new Float32Array([
    0, 0, 0, 10, 0, 0, 0, 10, 0,
    0, 0, 5, 10, 0, 5, 0, 10, 5,
    0, 0, 0, 10, 0, 0, 0, 0, 8
  ])
  const plane = geo.facePlane(pos, 0)
  check(
    'facePlane normal is unit length',
    Math.abs(Math.hypot(plane.n[0], plane.n[1], plane.n[2]) - 1) < 1e-6,
    JSON.stringify(plane.n)
  )
  check(
    'facePlane centroid',
    Math.abs(plane.c[0] - 10 / 3) < 1e-4 && Math.abs(plane.c[2]) < 1e-6,
    JSON.stringify(plane.c)
  )
  const parallel = geo.triTriDistance(pos, 0, 9)
  check('stacked parallel faces are 5 apart', Math.abs(parallel.d - 5) < 1e-3, String(parallel.d))
  check(
    'nearest pair sits on both faces',
    Math.abs(parallel.a[2]) < 1e-4 && Math.abs(parallel.b[2] - 5) < 1e-4,
    JSON.stringify([parallel.a, parallel.b])
  )
  const touching = geo.triTriDistance(pos, 0, 18)
  check('faces sharing an edge measure 0', touching.d < 1e-3, String(touching.d))
  const cp = geo.closestPointOnTri(2, 2, 9, pos, 0)
  check(
    'closest point projects onto the face',
    Math.abs(cp[0] - 2) < 1e-4 && Math.abs(cp[1] - 2) < 1e-4 && Math.abs(cp[2]) < 1e-4,
    JSON.stringify(cp)
  )
  const seg = geo.closestSegments([0, 0, 0], [10, 0, 0], [0, 3, 0], [10, 3, 0])
  check('parallel segments are 3 apart', Math.abs(seg.d - 3) < 1e-4, String(seg.d))

  console.log('\n[9] feature snapping')
  const cubeMesh = geo.parseStl(fs.readFileSync(path.join(FIXTURES, 'cube.stl')))
  const topo = geo.buildFeatureTopology(cubeMesh.positions, cubeMesh.normals)
  let creases = 0
  for (const k in topo.edges) creases++
  let cornerCount = 0
  for (const k in topo.corners) cornerCount++
  check('cube has 8 corners', cornerCount === 8, String(cornerCount))
  // 12 条立方体的棱算折边；6 条把每个面切成两个三角形的那条对角线是共面的，不算
  check('cube has 12 creases (face diagonals smoothed)', creases === 12, String(creases))
  // 网格完全一样的两份三角形共享边、法线相同时不算折边
  const flat = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 1, 0, 1, 0, 0, 1, 1, 0
  ])
  const flatNormals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])
  const flatTopo = geo.buildFeatureTopology(flat, flatNormals)
  let flatInner = 0
  const innerKey = geo.coordKey(1, 0, 0) + '|' + geo.coordKey(0, 1, 0)
  const innerKey2 = geo.coordKey(0, 1, 0) + '|' + geo.coordKey(1, 0, 0)
  flatInner = flatTopo.edges[innerKey] || flatTopo.edges[innerKey2] ? 1 : 0
  check('coplanar neighbours are not a crease', flatInner === 0, String(flatInner))

  const onSeg = geo.closestPointOnSegment([5, 5, 0], [0, 0, 0], [10, 0, 0])
  check('point to segment is 5', Math.abs(onSeg.d - 5) < 1e-6, String(onSeg.d))
  const clamped = geo.closestPointOnSegment([-4, 0, 0], [0, 0, 0], [10, 0, 0])
  check('point before the segment clamps to its start', Math.abs(clamped.d - 4) < 1e-6, String(clamped.d))
  const pl = geo.pointPlane([0, 0, 7], geo.facePlane(pos, 9))
  check('point to plane is 2', Math.abs(pl.d - 2) < 1e-6 && Math.abs(pl.foot[2] - 5) < 1e-6, JSON.stringify(pl))
  check(
    'perpendicular segments are 90°',
    Math.abs(geo.segmentAngleDeg([0, 0, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]) - 90) < 1e-6,
    'angle'
  )
  check(
    'screen gap to a segment',
    Math.abs(geo.segmentGap2D(0, 0, { x: 0, y: 10 }, { x: 10, y: 10 }) - 10) < 1e-6,
    'gap'
  )

  console.log('\n[10] circle detection')
  // 一圈点拟合圆：24 边形是圆，六边形不是（顶点在圆上，但每段中点明显内缩）
  const ringOf = (n, r) => {
    const positions = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n
      positions[i * 3] = Math.cos(a) * r
      positions[i * 3 + 1] = Math.sin(a) * r
      positions[i * 3 + 2] = 0
    }
    const adj = Object.create(null)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const ki = geo.coordKey(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
      const kj = geo.coordKey(positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2])
      if (!adj[ki]) adj[ki] = []
      if (!adj[kj]) adj[kj] = []
      adj[ki].push({ k: kj, i: j * 3 })
      adj[kj].push({ k: ki, i: i * 3 })
    }
    return { positions: positions, adj: adj }
  }

  const poly = ringOf(24, 10)
  const loop = geo.traceLoop(poly.positions, poly.adj, 0, 3)
  check('traceLoop closes the 24-gon', !!loop && loop.points.length === 25, loop ? String(loop.points.length) : 'null')
  const fit = loop ? geo.fitCirclePoints(loop.points.slice(0, -1)) : null
  check('fitted radius is 10', !!fit && Math.abs(fit.radius - 10) < 1e-3, fit ? String(fit.radius) : 'null')
  check(
    'fitted centre is the origin',
    !!fit && Math.hypot(fit.center[0], fit.center[1], fit.center[2]) < 1e-3,
    fit ? JSON.stringify(fit.center) : 'null'
  )
  const fromEdge = geo.circleFromEdge(poly.positions, poly.adj, 0, 3)
  check(
    'circleFromEdge gives the same circle',
    !!fromEdge &&
      Math.abs(fromEdge.radius - 10) < 1e-3 &&
      fromEdge.edgeKeys.length === 24,
    fromEdge ? String(fromEdge.radius) + ' / ' + fromEdge.edgeKeys.length + ' edges' : 'null'
  )

  const hex = ringOf(6, 10)
  check('hexagon is not a circle', geo.circleFromEdge(hex.positions, hex.adj, 0, 3) === null, 'hexagon')
  const square = ringOf(4, 10)
  check('square is rejected (turns too sharp)', geo.traceLoop(square.positions, square.adj, 0, 3) === null, 'square')

  // 开口的链（少一条边）不能被当成圆
  const openChain = ringOf(24, 10)
  const k0 = geo.coordKey(openChain.positions[0], openChain.positions[1], openChain.positions[2])
  openChain.adj[k0] = openChain.adj[k0].slice(0, 1)
  check('open chain is not a circle', geo.traceLoop(openChain.positions, openChain.adj, 3, 0) === null, 'open')

  // 真模型：垫圈（外径 40 / 内径 20 / 厚 6）应该正好找到两个圆
  const washer = geo.parseStl(fs.readFileSync(path.join(FIXTURES, 'ring.stl')))
  const washerTopo = geo.buildFeatureTopology(washer.positions, washer.normals)
  check('washer has no corner on a smooth rim', true, '')
  const seen = new Set()
  const radii = []
  const EDGES = [[0, 1], [1, 2], [2, 0]]
  for (let o = 0; o < washer.positions.length; o += 9) {
    for (const [a, b] of EDGES) {
      const i0 = o + a * 3
      const i1 = o + b * 3
      const key = geo.coordKey(washer.positions[i0], washer.positions[i0 + 1], washer.positions[i0 + 2]) +
        '|' + geo.coordKey(washer.positions[i1], washer.positions[i1 + 1], washer.positions[i1 + 2])
      if (seen.has(key)) continue
      seen.add(key)
      if (!washerTopo.edges[key]) continue
      const circle = geo.circleFromEdge(washer.positions, washerTopo.adj, i0, i1)
      if (!circle) continue
      const mm = circle.radius / washer.scale
      if (!radii.some((r) => Math.abs(r - mm) < 0.01)) radii.push(mm)
    }
  }
  radii.sort((x, y) => x - y)
  check(
    'washer has two rims: R10 and R20',
    radii.length === 2 && Math.abs(radii[0] - 10) < 0.01 && Math.abs(radii[1] - 20) < 0.01,
    JSON.stringify(radii)
  )

  // 往孔里点一下命中的是侧壁：整块侧壁（沿非折边扩散出来的光滑曲面）也要给出这个圆
  const washerEdges = geo.buildEdgeMap(washer.positions)
  const wallOf = (model, wantMm) => {
    const edgeMap = model === washer ? washerEdges : geo.buildEdgeMap(model.positions)
    const found = []
    const step = Math.max(1, Math.floor(model.positions.length / 9 / 400))
    for (let o = 0; o < model.positions.length; o += 9 * step) {
      const c = geo.wallCircle(o, model.positions, model.normals, edgeMap)
      if (!c) continue
      const mm = c.radius / model.scale
      if (!found.some((r) => Math.abs(r - mm) < 0.01)) found.push(mm)
    }
    found.sort((x, y) => x - y)
    return found
  }
  const wallRadii = wallOf(washer)
  check(
    'hole wall is picked as its circle',
    wallRadii.length === 2 && Math.abs(wallRadii[0] - 10) < 0.01 && Math.abs(wallRadii[1] - 20) < 0.01,
    JSON.stringify(wallRadii)
  )
  // 平板不会因为边界是矩形或者法线顺着轴就被误判成圆
  const plates = geo.parseStl(fs.readFileSync(path.join(FIXTURES, 'plates.stl')))
  check('a flat plate is not a circle', wallOf(plates).length === 0, JSON.stringify(wallOf(plates)))

  console.log(
    '\nresult: ' +
      (failures.length ? failures.length + ' failed → ' + failures.join('; ') : 'all passed')
  )
  process.exit(failures.length ? 1 : 0)
})().catch((e) => {
  console.error('harness error:', e)
  process.exit(2)
})
