'use strict'
/**
 * Corner-snapping check, end to end in a real WebGL renderer.
 *
 * The viewer snaps the cursor to a vertex, an edge or a face. This test scans the canvas for
 * pixels that report `kind === 'point'`, picks the two farthest apart (the diagonal of the
 * top plate) and measures between them, then asserts the readout.
 *
 *   env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS <electron> test/snap-points.cjs \
 *     "test/harness.html?file=./fixtures/plates.stl" [out.png]
 */
const os = require('os')
const fs = require('fs')
const path = require('path')
const { app, BrowserWindow } = require('electron')

// Two Electron instances sharing the default userData directory crash with
// "Unable to move the cache: 拒绝访问" - give each run its own.
app.setPath('userData', path.join(os.tmpdir(), 'dsh-stl-snap-' + process.pid))
// Software WebGL: the CI machine has no GPU and swiftshader needs to be opted into.
app.commandLine.appendSwitch('enable-unsafe-swiftshader')
app.commandLine.appendSwitch('use-gl', 'swiftshader')
app.commandLine.appendSwitch('allow-file-access-from-files')
app.disableHardwareAcceleration()

const SCRIPT = `
(async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const canvas = document.querySelector('canvas')
  const viewer = canvas.__dshStlViewer
  if (!viewer) return { error: 'viewer not mounted' }
  const rect = canvas.getBoundingClientRect()
  const event = (type, x, y) => {
    const target = type === 'pointerup' ? window : canvas
    target.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      pointerId: 1, isPrimary: true, bubbles: true, cancelable: true
    }))
  }
  const click = async (fx, fy) => {
    const x = rect.left + rect.width * fx
    const y = rect.top + rect.height * fy
    event('pointerdown', x, y)
    await sleep(30)
    event('pointerup', x, y)
    await sleep(120)
  }
  const button = Array.from(document.querySelectorAll('button'))
    .find((b) => /测量|Measure/.test(b.textContent))
  button.click()
  await sleep(400) // first hover builds the crease topology

  const seen = new Set()
  const points = []
  for (let gy = 1; gy <= 28; gy++) {
    for (let gx = 1; gx <= 40; gx++) {
      const fx = gx / 41
      const fy = gy / 29
      const f = viewer._test.pickFeature(rect.left + rect.width * fx, rect.top + rect.height * fy)
      if (!f || f.kind !== 'point') continue
      const key = f.p.map((v) => v.toFixed(3)).join(',')
      if (seen.has(key)) continue
      seen.add(key)
      points.push([fx, fy, f.p])
    }
  }
  if (points.length < 2) return { error: 'fewer than two corners snapped', corners: points.length }

  let a = points[0]
  let b = points[1]
  let best = -1
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(
        points[i][2][0] - points[j][2][0],
        points[i][2][1] - points[j][2][1],
        points[i][2][2] - points[j][2][2]
      )
      if (d > best) { best = d; a = points[i]; b = points[j] }
    }
  }
  await click(a[0], a[1])
  await click(b[0], b[1])

  const m = viewer._test.measure()
  return {
    corners: points.length,
    kinds: m && m.kinds,
    main: m && m.main,
    sub: m && m.sub,
    delta: m && m.delta,
    distance: m && Math.round(m.dist * 100) / 100,
    ariaPressed: button.getAttribute('aria-pressed')
  }
})()
`

app.whenReady().then(async () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const target = args[0] || 'test/harness.html?file=./fixtures/plates.stl'
  const out = args[1]
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: { offscreen: true, contextIsolation: false, nodeIntegration: false, webgl: true }
  })
  const url = /^[a-z]+:/i.test(target) ? target : 'file:///' + path.resolve(target).replace(/\\/g, '/')
  await win.loadURL(url)
  await new Promise((r) => setTimeout(r, 3500))

  let result
  try {
    result = await win.webContents.executeJavaScript(SCRIPT)
  } catch (e) {
    result = { error: e.message }
  }
  console.log('SNAP ' + JSON.stringify(result))

  if (out) {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(out, image.toPNG())
    console.log('WROTE ' + out + ' ' + fs.statSync(out).size)
  }

  const failures = []
  if (result.error) failures.push(result.error)
  if (result.kinds && (result.kinds[0] !== 'point' || result.kinds[1] !== 'point')) {
    failures.push('both picks should be points, got ' + JSON.stringify(result.kinds))
  }
  // The top plate is 40 x 42 mm; its diagonal is 58.0 mm with no Y component.
  if (result.main !== '58.0 mm') failures.push('expected 58.0 mm, got ' + JSON.stringify(result.main))
  if (result.delta) {
    const text = String(result.delta)
    if (!/ΔX 40\.0/.test(text) || !/ΔZ 42\.0/.test(text)) {
      failures.push('unexpected deltas ' + JSON.stringify(result.delta))
    }
  }
  console.log(failures.length ? 'FAIL ' + failures.join('; ') : 'PASS corner snapping')
  app.exit(failures.length ? 1 : 0)
})
