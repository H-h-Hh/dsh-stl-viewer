/*
 * End-to-end check for the face-to-face measure tool.
 *
 *   env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
 *     <electron> test/measure.cjs <harness-url> [out.png]
 *
 *   # default fixture: two plates with a 36 mm air gap
 *   <electron> test/measure.cjs "test/harness.html?file=./fixtures/plates.stl" measure.png
 *
 * The script does not guess pixel positions: it asks the viewer which face sits
 * under a probe point (`_test.pickFace`), finds one pixel per wanted face, clicks
 * both, and then reads back the measurement the component put on screen.
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

const MEASURE_SCRIPT = `
(async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const canvas = document.querySelector('canvas')
  const viewer = canvas.__dshStlViewer
  if (!viewer || !viewer._test) return { error: 'no _test hook on the viewer' }
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
    await sleep(90)
  }

  // 1) 在画布上撒一张网格，记下每个点命中的是哪个面（面 = 顶点缓冲里的字节偏移）。
  //    这样测试不依赖"模型正好落在屏幕哪个像素"，换相机/换窗口大小也照样过。
  const wanted = [0, 108] // plates.stl：下板顶面 / 上板顶面
  const found = new Map()
  for (let gy = 1; gy <= 16; gy++) {
    for (let gx = 1; gx <= 20; gx++) {
      const fx = gx / 21
      const fy = gy / 17
      const face = viewer._test.pickFace(rect.left + rect.width * fx, rect.top + rect.height * fy)
      if (wanted.indexOf(face) >= 0 && !found.has(face)) found.set(face, [fx, fy])
    }
  }
  const missing = wanted.filter((f) => !found.has(f))
  if (missing.length) return { error: 'faces not visible: ' + missing.join(','), grid: [...found.entries()] }

  // 2) 先开测量，再依次点这两个面。
  const button = Array.from(document.querySelectorAll('button')).find((b) => /测量|Measure/.test(b.textContent))
  if (!button) return { error: 'no measure button' }
  button.click()
  await sleep(150)
  const hintFirst = document.body.innerText.slice(0, 240)

  await click(found.get(wanted[0])[0], found.get(wanted[0])[1])
  const afterFirst = document.body.innerText.slice(0, 240)
  const picksAfterFirst = viewer._test.picks().length
  await click(found.get(wanted[1])[0], found.get(wanted[1])[1])
  await sleep(200)

  const measure = viewer._test.measure()
  const labelBox = Array.from(document.querySelectorAll('div'))
    .find((d) => d.style && d.style.borderRadius === '7px' && /mm/.test(d.textContent))
  const labelText = labelBox ? labelBox.textContent : ''
  const number = /([\\d.,]+)\\s*mm/.exec(labelText)

  return {
    clicked: [found.get(wanted[0]), found.get(wanted[1])],
    picksAfterFirst: picksAfterFirst,
    picksAfterSecond: viewer._test.picks().length,
    distance: number ? parseFloat(number[1].replace(/,/g, '')) : null,
    rawDistance: measure ? measure.dist : null,
    parallel: measure ? measure.parallel : null,
    angleDeg: measure ? measure.angleDeg : null,
    labelVisible: labelBox ? labelBox.style.display !== 'none' : false,
    labelText: labelText,
    measurePressed: button.getAttribute('aria-pressed'),
    hintBeforePick: /点两个面|Click two faces/.test(hintFirst),
    hintAfterFirst: /再点一个面|Click a second face/.test(afterFirst)
  }
})()
`

// Esc must leave measure mode and hide the label.
const ESC_SCRIPT = `
(async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(200)
  const canvas = document.querySelector('canvas')
  const viewer = canvas.__dshStlViewer
  const labelBox = Array.from(document.querySelectorAll('div'))
    .find((d) => d.style && d.style.borderRadius === '7px')
  const button = Array.from(document.querySelectorAll('button'))
    .find((b) => /测量|Measure/.test(b.textContent))
  return {
    labelHidden: labelBox ? labelBox.style.display === 'none' : true,
    picks: viewer._test.picks().length,
    measure: viewer._test.measure(),
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

  const measured = await win.webContents.executeJavaScript(MEASURE_SCRIPT)
  console.log('MEASURE ' + JSON.stringify(measured))
  if (out) {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(out, image.toPNG())
    console.log('WROTE ' + out + ' ' + fs.statSync(out).size)
  }
  const escaped = await win.webContents.executeJavaScript(ESC_SCRIPT)
  console.log('ESCAPE ' + JSON.stringify(escaped))
  app.quit()
})
