/*
 * End-to-end check for picking a bore whose wall carries screw holes.
 *
 *   env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \\
 *     <electron> test/hub.cjs <harness-url> [out.png] [expected-diameter-mm]
 *
 *   # default: the 25x47x7 bearing seat of the wheel hub
 *   <electron> test/hub.cjs "test/harness.html?file=./_gear47.stl" hub.png 47
 *
 * The bore wall is interrupted by four Ø2.9 set-screw holes, so its boundary is
 * not two clean circles: the loops of those holes hang on it too. This test
 * clicks straight into the bore — not on the rim — and expects the Ø / R panel
 * to report the bearing seat, which is the case that used to be unmeasurable.
 */
'use strict'

const os = require('os')
const fs = require('fs')
const path = require('path')
const { app, BrowserWindow } = require('electron')

app.setPath('userData', path.join(os.tmpdir(), 'dsh-stl-shoot-' + process.pid))
app.commandLine.appendSwitch('enable-unsafe-swiftshader')
app.commandLine.appendSwitch('use-gl', 'swiftshader')
app.commandLine.appendSwitch('allow-file-access-from-files')
app.disableHardwareAcceleration()

const HUB_SCRIPT = `
(async function () {
  const want = __WANT__
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
    await sleep(140)
  }
  const escape = async () => {
    viewer._test.clear()   // 只清选择，不退出测量模式（Esc 会退出模式）
    await sleep(60)
  }

  // 1) 找候选：屏幕上每个圆各留一个像素。
  const byRadius = new Map()
  for (let gy = 1; gy <= 36; gy++) {
    for (let gx = 1; gx <= 48; gx++) {
      const fx = gx / 49
      const fy = gy / 37
      const [x, y] = at(fx, fy)
      const f = viewer._test.pickFeature(x, y)
      if (!f || f.kind !== 'circle') continue
      const key = Math.round(f.radius * 100000)
      if (!byRadius.has(key)) byRadius.set(key, { fx: fx, fy: fy, radius: f.radius, loop: f.loop.length })
    }
  }
  const circles = [...byRadius.values()].sort((a, b) => b.radius - a.radius)

  const button = Array.from(document.querySelectorAll('button')).find((b) => /测量|Measure/.test(b.textContent))
  if (!button) return { error: 'no measure button' }
  if (!circles.length) return { error: 'no circle pixel found' }
  button.click()
  await sleep(150)

  // 2) 从大到小点一遍，直到面板给出的直径等于期望值。
  const tried = []
  let hit = null
  for (const c of circles) {
    await click(c.fx, c.fy)
    const single = viewer._test.single()
    const main = single ? single.main : null
    tried.push({ radius: c.radius, main: main, picks: viewer._test.picks().length, measure: viewer._test.measure() })
    if (main && main.indexOf(want) === 0) { hit = { c: c, single: single }; break }
    await escape()
  }
  if (!hit) return { error: 'diameter not found', want: want, tried: tried }

  const picked = viewer._test.picks()
  const panel = document.querySelector('.dsh-stl-panel')
  const label = document.querySelector('.dsh-stl-label')
  return {
    want: want,
    circles: circles.length,
    clicked: [hit.c.fx, hit.c.fy],
    loopPoints: hit.c.loop,
    picksAfterClick: picked.length,
    pickedKind: picked.length ? picked[0].kind : null,
    singleMain: hit.single.main,
    singleSub: hit.single.sub,
    panelVisible: panel ? panel.style.display !== 'none' : false,
    panelText: panel ? panel.textContent : '',
    labelText: label ? label.textContent : '',
    tried: tried
  }
})()
`

const ESC_SCRIPT = `
(async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(200)
  const canvas = document.querySelector('canvas')
  const viewer = canvas.__dshStlViewer
  const panel = document.querySelector('.dsh-stl-panel')
  const label = document.querySelector('.dsh-stl-label')
  return {
    picks: viewer._test.picks().length,
    single: viewer._test.single(),
    panelHidden: panel ? panel.style.display === 'none' : true,
    labelHidden: label ? label.style.display === 'none' : true
  }
})()
`

app.whenReady().then(async () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const target = args[0]
  const out = args[1]
  const want = args[2] || '47'

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

  const script = HUB_SCRIPT.replace('__WANT__', JSON.stringify('Ø ' + want + '.0 mm'))
  const result = await win.webContents.executeJavaScript(script)
  console.log('HUB ' + JSON.stringify(result))
  if (out) {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(out, image.toPNG())
    console.log('WROTE ' + out + ' ' + fs.statSync(out).size)
  }
  const escaped = await win.webContents.executeJavaScript(ESC_SCRIPT)
  console.log('ESCAPE ' + JSON.stringify(escaped))
  app.quit()
})
