/*
 * End-to-end check for the measure tool.
 *
 *   env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \\
 *     <electron> test/measure.cjs <harness-url> [out.png]
 *
 *   # default fixture: two plates with a 36 mm air gap
 *   <electron> test/measure.cjs "test/harness.html?file=./fixtures/plates.stl" measure.png
 *
 * The script does not guess pixel positions. It asks the viewer what the cursor
 * would snap to at a probe point (`_test.pickFeature`), keeps one pixel per flat
 * region, clicks both, and then reads back what the component put on screen.
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
  const labelBox = () => document.querySelector('.dsh-stl-label')

  // 1) 撒一张网格，问 viewer 每个像素会吸附成什么，记下"确实会选中这块平面"的像素。
  //    吸附角点/棱的像素会被跳过，所以这仍然不依赖模型在屏幕上的位置。
  const wanted = [0, 108] // plates.stl：下板顶面 / 上板顶面
  const found = new Map()
  for (let gy = 1; gy <= 16; gy++) {
    for (let gx = 1; gx <= 20; gx++) {
      const fx = gx / 21
      const fy = gy / 17
      const f = viewer._test.pickFeature(rect.left + rect.width * fx, rect.top + rect.height * fy)
      if (f && f.kind === 'face' && wanted.indexOf(f.o) >= 0 && !found.has(f.o)) found.set(f.o, [fx, fy])
    }
  }
  const missing = wanted.filter((f) => !found.has(f))
  if (missing.length) return { error: 'no bare-face pixel for: ' + missing.join(','), grid: [...found.entries()] }

  // 2) 开测量，依次点这两个面。
  const button = Array.from(document.querySelectorAll('button')).find((b) => /测量|Measure/.test(b.textContent))
  if (!button) return { error: 'no measure button' }
  button.click()
  await sleep(150)
  const hintFirst = document.body.innerText.slice(0, 260)

  await click(found.get(wanted[0])[0], found.get(wanted[0])[1])
  const afterFirst = document.body.innerText.slice(0, 260)
  const picksAfterFirst = viewer._test.picks().length
  await click(found.get(wanted[1])[0], found.get(wanted[1])[1])
  await sleep(200)

  const measure = viewer._test.measure()
  const box = labelBox()
  const labelText = box ? box.textContent : ''
  const number = /([\\d.,]+)\\s*mm/.exec(labelText)

  return {
    clicked: [found.get(wanted[0]), found.get(wanted[1])],
    picksAfterFirst: picksAfterFirst,
    picksAfterSecond: viewer._test.picks().length,
    kinds: measure ? measure.kinds : null,
    distance: number ? parseFloat(number[1].replace(/,/g, '')) : null,
    rawDistance: measure ? measure.dist : null,
    parallel: measure ? measure.parallel : null,
    main: measure ? measure.main : null,
    sub: measure ? measure.sub : null,
    labelVisible: box ? box.style.display !== 'none' : false,
    labelText: labelText,
    measurePressed: button.getAttribute('aria-pressed'),
    hintBeforePick: /点顶点|Click a vertex/.test(hintFirst),
    hintAfterFirst: /再点一个点|Click a second point/.test(afterFirst)
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
  const labelBox = document.querySelector('.dsh-stl-label')
  const panel = document.querySelector('.dsh-stl-panel')
  const button = Array.from(document.querySelectorAll('button'))
    .find((b) => /测量|Measure/.test(b.textContent))
  return {
    labelHidden: labelBox ? labelBox.style.display === 'none' : true,
    panelHidden: panel ? panel.style.display === 'none' : true,
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
