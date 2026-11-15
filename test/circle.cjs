/*
 * End-to-end check for circle picking.
 *
 *   env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \\
 *     <electron> test/circle.cjs <harness-url> [out.png]
 *
 *   # default fixture: washer, outer Ø 40, inner Ø 20, 6 thick
 *   <electron> test/circle.cjs "test/harness.html?file=./fixtures/ring.stl" circle.png
 *
 * The washer has two rims, and they are two different circles. The point of
 * this test is that clicking a rim selects the whole circle — not one of the
 * many tiny crease edges that the rim is made of — and that the Ø / R panel in
 * the top-left corner appears for it.
 */
'use strict'

const os = require('os')
const fs = require('fs')
const path = require('path')
const { app, BrowserWindow } = require('electron')

// separate userData dir: two Electron instances sharing the default one fight over the cache
app.setPath('userData', path.join(os.tmpdir(), 'dsh-stl-shoot-' + process.pid))
app.commandLine.appendSwitch('enable-unsafe-swiftshader')
app.commandLine.appendSwitch('use-gl', 'swiftshader')
app.commandLine.appendSwitch('allow-file-access-from-files')
app.disableHardwareAcceleration()

const CIRCLE_SCRIPT = `
(async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const canvas = document.querySelector('canvas')
  const viewer = canvas.__dshStlViewer
  if (!viewer || !viewer._test) return { error: 'no _test hook on the viewer' }
  const rect = canvas.getBoundingClientRect()
  const at = (fx, fy) => [rect.left + rect.width * fx, rect.top + rect.height * fy]
  const event = (type, x, y) => {
    const target = type === 'pointerup' ? window : canvas
    target.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      pointerId: 1, isPrimary: true, bubbles: true, cancelable: true
    }))
  }
  const click = async (fx, fy) => {
    const [x, y] = at(fx, fy)
    event('pointerdown', x, y)
    await sleep(30)
    event('pointerup', x, y)
    await sleep(120)
  }

  // 1) 网格扫描：问 viewer 每个位置会选中什么，按半径归类，只留圆。
  const byRadius = new Map()
  for (let gy = 1; gy <= 30; gy++) {
    for (let gx = 1; gx <= 40; gx++) {
      const fx = gx / 41
      const fy = gy / 31
      const [x, y] = at(fx, fy)
      const f = viewer._test.pickFeature(x, y)
      if (!f || f.kind !== 'circle') continue
      const key = Math.round(f.radius * 1000)
      if (!byRadius.has(key)) byRadius.set(key, { fx: fx, fy: fy, radius: f.radius, center: f.center, loop: f.loop.length })
    }
  }
  const circles = [...byRadius.values()].sort((a, b) => a.radius - b.radius)

  const button = Array.from(document.querySelectorAll('button')).find((b) => /测量|Measure/.test(b.textContent))
  if (!button) return { error: 'no measure button' }
  button.click()
  await sleep(150)
  if (!circles.length) return { error: 'no circle pixel found', pressed: button.getAttribute('aria-pressed') }

  // 2) 点最小的那个圆（垫圈内圈）。
  const inner = circles[0]
  await click(inner.fx, inner.fy)
  await sleep(200)

  const single = viewer._test.single()
  const picked = viewer._test.picks()
  const panel = document.querySelector('.dsh-stl-panel')
  const label = document.querySelector('.dsh-stl-label')

  return {
    circles: circles.map((c) => ({ radius: c.radius, loop: c.loop })),
    circleCount: circles.length,
    clicked: [inner.fx, inner.fy],
    picksAfterClick: picked.length,
    pickedKind: picked.length ? picked[0].kind : null,
    pickedRadius: picked.length ? picked[0].radius : null,
    singleMain: single ? single.main : null,
    singleSub: single ? single.sub : null,
    panelVisible: panel ? panel.style.display !== 'none' : false,
    panelText: panel ? panel.textContent : '',
    labelVisible: label ? label.style.display !== 'none' : false,
    labelText: label ? label.textContent : '',
    measurePressed: button.getAttribute('aria-pressed')
  }
})()
`

// Esc must drop the circle selection and hide the Ø / R panel again.
const ESC_SCRIPT = `
(async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(200)
  const canvas = document.querySelector('canvas')
  const viewer = canvas.__dshStlViewer
  const panel = document.querySelector('.dsh-stl-panel')
  const label = document.querySelector('.dsh-stl-label')
  const button = Array.from(document.querySelectorAll('button'))
    .find((b) => /测量|Measure/.test(b.textContent))
  return {
    picks: viewer._test.picks().length,
    single: viewer._test.single(),
    panelHidden: panel ? panel.style.display === 'none' : true,
    labelHidden: label ? label.style.display === 'none' : true,
    measurePressed: button ? button.getAttribute('aria-pressed') : null
  }
})()
`

app.whenReady().then(async () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const target = args[0]
  const out = args[1]

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: false,
      nodeIntegration: false,
      webgl: true
    }
  })
  win.webContents.on('console-message', (_e, level, message) => {
    console.log('[console:' + level + '] ' + message)
  })
  const url = /^[a-z]+:/i.test(target)
    ? target
    : 'file:///' + path.resolve(target).replace(/\\/g, '/')
  await win.loadURL(url)
  await new Promise((r) => setTimeout(r, 3500))

  const result = await win.webContents.executeJavaScript(CIRCLE_SCRIPT)
  console.log('CIRCLE ' + JSON.stringify(result))
  if (out) {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(out, image.toPNG())
    console.log('WROTE ' + out + ' ' + fs.statSync(out).size)
  }
  const escaped = await win.webContents.executeJavaScript(ESC_SCRIPT)
  console.log('ESCAPE ' + JSON.stringify(escaped))
  app.quit()
})
