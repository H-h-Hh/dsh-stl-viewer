// One-shot headless screenshot of the viewer, used for the README images.
//   env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
//     <electron> test/shoot.cjs "test/harness.html?file=./fixtures/cube.stl" out.png
// SwiftShader switches make WebGL work without a GPU (CI, sandboxes, VMs).
const os = require('os')
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const target = process.argv[process.argv.length - 2]
const out = process.argv[process.argv.length - 1]
const width = 900
const height = 700

// separate userData dir: two Electron instances sharing the default one fight over the cache
app.setPath('userData', path.join(os.tmpdir(), 'dsh-stl-shoot-' + process.pid))
app.commandLine.appendSwitch('enable-unsafe-swiftshader')
app.commandLine.appendSwitch('use-gl', 'swiftshader')
app.commandLine.appendSwitch('allow-file-access-from-files')
app.disableHardwareAcceleration()

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
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('did-fail-load', code, desc)
  })
  const url = /^[a-z]+:/i.test(target)
    ? target
    : 'file:///' + path.resolve(target).replace(/\\/g, '/')
  await win.loadURL(url)
  await new Promise((r) => setTimeout(r, 3500))
  const info = await win.webContents.executeJavaScript(
    'JSON.stringify({ mounted: !!window.__mounted, desc: window.__viewerDescriptor && window.__viewerDescriptor.id, text: document.body.innerText.slice(0, 400) })'
  )
  console.log('INFO ' + info)
  const image = await win.webContents.capturePage()
  fs.writeFileSync(out, image.toPNG())
  console.log('WROTE ' + out + ' ' + fs.statSync(out).size)
  app.quit()
})
