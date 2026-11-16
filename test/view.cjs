/*
 * End-to-end check for the view menu: preset angle, wireframe, turntable,
 * PNG snapshot and the shortcut card.
 *
 *   env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
 *     <electron> test/view.cjs <harness-url> [out.png]
 *
 *   <electron> test/view.cjs "test/harness.html?file=./fixtures/ring.stl" view.png
 *
 * Everything here is driven through the real UI: the 视图 button, the menu rows
 * inside .dsh-stl-menu, and the shortcut card. Nothing calls the viewer directly
 * except to read back the state it should have put itself in.
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

const VIEW_SCRIPT = `
(async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const canvas = document.querySelector('canvas')
  const viewer = canvas && canvas.__dshStlViewer
  if (!viewer || !viewer._test) return { error: 'no _test hook on the viewer' }
  const test = viewer._test

  const buttonBy = (re) =>
    Array.from(document.querySelectorAll('button')).find((b) => re.test(b.textContent))
  const viewsButton = buttonBy(/^(视图|View)/)
  if (!viewsButton) return { error: 'no view button' }
  const menu = () => document.querySelector('.dsh-stl-menu')
  const rowBy = (re) =>
    menu() ? Array.from(menu().querySelectorAll('button')).find((b) => re.test(b.textContent)) : null

  const openMenu = async () => {
    if (!menu()) {
      viewsButton.click()
      await sleep(140)
    }
    return menu()
  }

  const statsText = () => {
    const nodes = Array.from(document.querySelectorAll('div'))
      .filter((n) => /三角面|triangles/.test(n.textContent) && n.children.length <= 2)
    return nodes.length ? nodes[nodes.length - 1].textContent : ''
  }

  const before = test.camera()
  const stats = statsText()

  // 1) 视图 → 俯视，镜头要转到正上方，而且缩放不能变
  await openMenu()
  const topRow = rowBy(/俯视|^Top/)
  if (!topRow) return { error: 'no top row', menuOpen: !!menu() }
  topRow.click()
  await sleep(600)
  const afterTop = test.camera()
  const menuClosedAfterPick = !menu()

  // 2) 视图 → 线框
  await openMenu()
  const wireRow = rowBy(/线框|Wireframe/)
  if (!wireRow) return { error: 'no wireframe row' }
  wireRow.click()
  await sleep(400)
  const wireOn = test.wire()

  // 3) 视图 → 自动旋转，转一会儿再关掉
  await openMenu()
  const spinRow = rowBy(/自动旋转|Turntable/)
  if (!spinRow) return { error: 'no turntable row' }
  spinRow.click()
  await sleep(120)
  const spinOn = test.spin()
  const spinYaw0 = test.camera().yaw
  await sleep(500)
  const spinYaw1 = test.camera().yaw
  await openMenu()
  const spinOffRow = rowBy(/自动旋转|Turntable/)
  spinOffRow.click()
  await sleep(120)
  const spinOff = !test.spin()

  // 4) 保存图片：只要数据是真的 PNG 就行，不真的触发下载
  const png = test.snapshot()
  const pngOk = typeof png === 'string' && png.indexOf('data:image/png;base64,') === 0 && png.length > 2000

  // 5) 快捷键卡片：打开后再点背板关掉
  await openMenu()
  const helpRow = rowBy(/快捷键|Shortcuts/)
  if (!helpRow) return { error: 'no help row' }
  helpRow.click()
  await sleep(200)
  const help = document.querySelector('.dsh-stl-help')
  const helpText = help ? help.textContent : ''
  const helpOpen = !!help
  if (help) {
    help.click()
    await sleep(180)
  }
  const helpClosed = !document.querySelector('.dsh-stl-help')

  // 6) 快捷键 2 也应当转到俯视（画布聚焦时）
  canvas.focus()
  viewer.setView('iso')
  await sleep(400)
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }))
  await sleep(600)
  const afterKey2 = test.camera()

  return {
    menuOpenOnClick: true,
    menuClosedAfterPick: menuClosedAfterPick,
    viewsLabel: viewsButton.textContent,
    before: before,
    afterTop: afterTop,
    topIsUp: Math.abs(afterTop.pitch - 1.5607) < 0.02 && Math.abs(afterTop.yaw) < 0.02,
    zoomKept: Math.abs(afterTop.dist - before.dist) < 0.001,
    wireOn: wireOn,
    spinOn: spinOn,
    spinAdvanced: spinYaw1 - spinYaw0 > 0.1,
    spinOff: spinOff,
    pngBytes: png ? png.length : 0,
    pngOk: pngOk,
    helpOpen: helpOpen,
    helpHasShortcuts: /快捷键|Shortcuts/.test(helpText),
    helpClosed: helpClosed,
    key2IsUp: Math.abs(afterKey2.pitch - 1.5607) < 0.02,
    stats: stats
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

  const result = await win.webContents.executeJavaScript(VIEW_SCRIPT)
  console.log('VIEW ' + JSON.stringify(result))
  if (out) {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(out, image.toPNG())
    console.log('WROTE ' + out + ' ' + fs.statSync(out).size)
  }
  app.quit()
})
