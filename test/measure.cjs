// End-to-end check for the measure tool: click two points on the model, read
// the distance label, screenshot, then verify Esc leaves measure mode.
//   env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
//     <electron> test/measure.cjs [out.png]
const os = require('os')
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const out = process.argv[process.argv.length - 1]
const width = 900
const height = 700

// separate userData dir: two Electron instances sharing the default one fight over the cache
app.setPath('userData', path.join(os.tmpdir(), 'dsh-stl-shoot-' + process.pid))
app.commandLine.appendSwitch('enable-unsafe-swiftshader')
app.commandLine.appendSwitch('use-gl', 'swiftshader')
app.commandLine.appendSwitch('allow-file-access-from-files')
app.disableHardwareAcceleration()

// Clicks the Measure button and two points on the cube, then reads the label.
const MEASURE_SCRIPT = `
(async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const canvas = document.querySelector('canvas')
  const buttons = Array.from(document.querySelectorAll('button'))
  const measureButton = buttons.find((b) => /测量|Measure/.test(b.textContent))
  if (!measureButton) return { error: 'no measure button' }
  measureButton.click()
  await sleep(120)

  const rect = canvas.getBoundingClientRect()
  const fire = (type, x, y) => {
    const target = type === 'pointerup' ? window : canvas
    target.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      pointerId: 1, isPrimary: true, bubbles: true, cancelable: true
    }))
  }
  const click = async (x, y) => {
    fire('pointerdown', x, y)
    await sleep(30)
    fire('pointerup', x, y)
    await sleep(90)
  }

  // 立方体基本占满画面，中心附近和左上一点都落在正面上
  await click(rect.left + rect.width * 0.5, rect.top + rect.height * 0.5)
  await click(rect.left + rect.width * 0.38, rect.top + rect.height * 0.40)
  await sleep(150)

  const labelBox = Array.from(document.querySelectorAll('div'))
    .find((d) => d.style && d.style.borderRadius === '7px' && /mm/.test(d.textContent))
  const distText = labelBox ? labelBox.textContent : ''
  const match = /([\\d.,]+)\\s*mm/.exec(distText)

  return {
    labelVisible: labelBox ? labelBox.style.display !== 'none' : false,
    labelText: distText,
    distance: match ? parseFloat(match[1].replace(/,/g, '')) : null,
    labelLeft: labelBox ? Math.round(parseFloat(labelBox.style.left)) : null,
    labelTop: labelBox ? Math.round(parseFloat(labelBox.style.top)) : null,
    measurePressed: measureButton.getAttribute('aria-pressed'),
    hintText: (document.body.innerText.match(/点两个点|Click two points/) || [''])[0]
  }
})()
`

// Esc must leave measure mode and hide the label.
const ESC_SCRIPT = `
(async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(150)
  const labelBox = Array.from(document.querySelectorAll('div'))
    .find((d) => d.style && d.style.borderRadius === '7px' && /mm/.test(d.textContent))
  const button = Array.from(document.querySelectorAll('button'))
    .find((b) => /测量|Measure/.test(b.textContent))
  return {
    labelHidden: labelBox ? labelBox.style.display === 'none' : true,
    measurePressed: button ? button.getAttribute('aria-pressed') : null
  }
})()
`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
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
  const target = process.argv[process.argv.length - 2]
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
