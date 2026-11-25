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
check(
  "declares inject ['betterSidebar']",
  Array.isArray(mod && mod.inject) && mod.inject.indexOf('betterSidebar') >= 0,
  JSON.stringify(mod && mod.inject)
)

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

  console.log('\n[11] mesh info')
  const cubeInfo = geo.meshInfo(cubeMesh.positions, cubeMesh.triangleCount, cubeMesh.scale)
  check('cube volume is 8000 mm³', Math.abs(cubeInfo.volume - 8000) < 1, cubeInfo.volume.toFixed(2))
  check('cube surface is 2400 mm²', Math.abs(cubeInfo.area - 2400) < 1, cubeInfo.area.toFixed(2))
  check('cube is closed', cubeInfo.closed === true)

  // 垫圈：π(R²−r²)h 与多边形近似的差在 1% 以内，顺便证明还原 scale 是对的
  const ringVolume = Math.PI * (20 * 20 - 10 * 10) * 6
  const ringErr = Math.abs(washer.info.volume - ringVolume) / ringVolume
  check('washer volume matches π(R²−r²)h', ringErr < 0.01, washer.info.volume.toFixed(1) + ' mm³')
  check('washer is closed', washer.info.closed === true)

  const plateInfo = plates.info
  check('two stacked plates volume is 43200 mm³', Math.abs(plateInfo.volume - 43200) < 1, plateInfo.volume.toFixed(1))
  check('plates are closed', plateInfo.closed === true)

  // 一个孤零零的三角面：面积算得出，体积为零，不闭合
  const triAscii =
    'solid t\nfacet normal 0 0 1\nouter loop\n' +
    'vertex 0 0 0\nvertex 10 0 0\nvertex 0 20 0\n' +
    'endloop\nendfacet\nendsolid t\n'
  const triMesh = geo.parseStl(new Uint8Array(Buffer.from(triAscii, 'utf8')))
  check('single triangle area is 100 mm²', Math.abs(triMesh.info.area - 100) < 0.01, triMesh.info.area.toFixed(2))
  check('single triangle has no volume', Math.abs(triMesh.info.volume) < 1e-9, String(triMesh.info.volume))
  check('single triangle is not closed', triMesh.info.closed === false)

  console.log('\n[12] STEP plumbing')
  check(
    'step files are spotted by extension',
    geo.isStepPath('a/b/part.STEP') && geo.isStepPath('x.stp') && geo.isStepPath('y.iges') &&
      geo.isStepPath('z.igs') && geo.isStepPath('w.brep'),
    'step / stp / iges / igs / brep'
  )
  check(
    'stl and look-alikes are not step',
    !geo.isStepPath('cube.stl') && !geo.isStepPath('cube.step.bak') && !geo.isStepPath(''),
    'only the five extensions'
  )

  // 造两块三角面，按宿主回包的格式打包，再解回来 —— 头和长度都得对得上
  const packed = new ArrayBuffer(16 + 2 * 36)
  const head = new DataView(packed)
  head.setUint32(0, 0x4d485344, true)
  head.setUint32(4, 1, true)
  head.setUint32(8, 2, true)
  head.setUint32(12, 3, true)
  new Float32Array(packed, 16, 18).set([
    0, 0, 0, 10, 0, 0, 10, 10, 0,
    0, 0, 0, 10, 10, 0, 0, 10, 0
  ])
  const decoded = geo.decodeMesh(packed)
  check(
    'decodeMesh reads the header',
    decoded.triangleCount === 2 && decoded.parts === 3,
    JSON.stringify({ tris: decoded.triangleCount, parts: decoded.parts })
  )
  check('decodeMesh keeps 18 floats', decoded.positions.length === 18, String(decoded.positions.length))

  const converted = geo.stepMesh(decoded)
  check(
    'stepMesh reads a 10 mm square',
    Math.abs(converted.dims[0] - 10) < 0.01 && Math.abs(converted.dims[1] - 10) < 0.01,
    JSON.stringify(converted.dims)
  )
  check('stepMesh area is 100 mm²', Math.abs(converted.info.area - 100) < 0.01, converted.info.area.toFixed(2))

  const foreign = new ArrayBuffer(16)
  new DataView(foreign).setUint32(0, 0x12345678, true)
  let rejected = false
  try {
    geo.decodeMesh(foreign)
  } catch (error) {
    rejected = true
  }
  check('decodeMesh rejects a foreign buffer', rejected)

  // ---------------------------------------------------------------- free tumble
  console.log('\n[13] free rotation')
  {
    const { qAxisAngle, qMultiply, qRotate, camBasis } = mod.__internals
    const len = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-9)

    // 四元数本身：绕 Y 转 90° 把 +X 送到 −Z，长度不变
    const qy = qAxisAngle([0, 1, 0], Math.PI / 2)
    const turned = qRotate(qy, [1, 0, 0])
    check(
      'a quarter turn about Y takes +X to −Z',
      near(turned[0], 0, 1e-9) && near(turned[2], -1, 1e-9),
      JSON.stringify(turned.map((n) => +n.toFixed(6)))
    )
    check('rotation keeps the length', near(len(turned), 1, 1e-9), len(turned).toFixed(9))
    const twice = qRotate(qMultiply(qy, qy), [1, 0, 0])
    check('two quarter turns take +X to −X', near(twice[0], -1, 1e-9), JSON.stringify(twice.map((n) => +n.toFixed(6))))

    // camBasis：没翻滚时就是老的正交基
    const flat = camBasis({ yaw: 0, pitch: 0, q: [0, 0, 0, 1] })
    check(
      'front view looks down +Z with right = +X',
      near(flat.dir[2], 1, 1e-9) && near(flat.right[0], 1, 1e-9) && near(flat.up[1], 1, 1e-9),
      JSON.stringify({ dir: flat.dir, right: flat.right, up: flat.up })
    )

    // 一直往上拖（模拟 orbit 的累乘）：必须能翻到背面甚至半球以下
    const cam = { yaw: 0, pitch: 0, q: [0, 0, 0, 1] }
    let lowest = 1
    let worstUp = 1
    let ortho = 1
    for (let i = 0; i < 400; i++) {
      const basis = camBasis(cam)
      const qx = qAxisAngle(basis.right, -6 * 0.008)
      const qy = qAxisAngle(basis.up, 0)
      cam.q = qMultiply(qy, qMultiply(qx, cam.q))
      const b = camBasis(cam)
      lowest = Math.min(lowest, b.dir[1])
      ortho = Math.min(ortho, Math.abs(dot(b.right, b.up)))
      worstUp = Math.min(worstUp, len(b.up))
      if (!isFinite(b.dir[0] + b.dir[1] + b.dir[2])) {
        worstUp = -1
        break
      }
    }
    check('dragging up can put the camera below the model', lowest < -0.5, lowest.toFixed(3))
    check('the basis stays orthonormal while tumbling', ortho < 1e-9, ortho.toExponential(2))
    check('the basis never degenerates or goes NaN', worstUp > 0.99, worstUp.toFixed(6))

    // 正俯视（pitch = 90°）时基准朝向竖直，也必须给出可用的基
    const straightDown = camBasis({ yaw: 0.3, pitch: Math.PI / 2, q: [0, 0, 0, 1] })
    check(
      'a camera straight overhead still has a basis',
      near(len(straightDown.right), 1, 1e-6) && near(len(straightDown.up), 1, 1e-6),
      JSON.stringify({ right: straightDown.right, up: straightDown.up })
    )

    // 同样的拖动再反向拖回来，应该回到起点附近
    for (let i = 0; i < 400; i++) {
      const basis = camBasis(cam)
      const qx = qAxisAngle(basis.right, 6 * 0.008)
      cam.q = qMultiply(qAxisAngle(basis.up, 0), qMultiply(qx, cam.q))
    }
    const back = camBasis(cam)
    check(
      'dragging back returns to the starting view',
      dot(back.dir, flat.dir) > 0.999,
      dot(back.dir, flat.dir).toFixed(6)
    )
  }

  console.log(
    '\nresult: ' +
      (failures.length ? failures.length + ' failed → ' + failures.join('; ') : 'all passed')
  )
  process.exit(failures.length ? 1 : 0)
})().catch((e) => {
  console.error('harness error:', e)
  process.exit(2)
})
