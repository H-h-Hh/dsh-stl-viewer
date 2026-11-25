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

  const axisState = () => {
    const svg = document.querySelector('.dsh-stl-axis')
    if (!svg) return null
    const lines = Array.from(svg.querySelectorAll('line')).map((l) => ({
      dx: Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')),
      dy: Number(l.getAttribute('y2')) - Number(l.getAttribute('y1'))
    }))
    const labels = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent)
    return { labels, lines, hidden: svg.style.display === 'none' }
  }

  const before = test.camera()
  const stats = statsText()
  const axisBefore = axisState()

  // 1) 视图 → 俯视，镜头要转到正上方，而且缩放不能变
  await openMenu()
  const topRow = rowBy(/俯视|^Top/)
  if (!topRow) return { error: 'no top row', menuOpen: !!menu() }
  topRow.click()
  await sleep(600)
  const afterTop = test.camera()
  const axisTop = axisState()
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

  // 6) 坐标轴：菜单里能关，G 键能再开
  await openMenu()
  const axesRow = rowBy(/坐标轴|Axes/)
  if (!axesRow) return { error: 'no axes row' }
  axesRow.click()
  await sleep(200)
  const axisOff = !test.axis() && !!axisState() && axisState().hidden
  canvas.focus()
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }))
  await sleep(200)
  const axisBackOn = test.axis() && !axisState().hidden

  // 7) 快捷键 2 也应当转到俯视（画布聚焦时）
  canvas.focus()
  viewer.setView('iso')
  await sleep(400)
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }))
  await sleep(600)
  const afterKey2 = test.camera()

  // 8) 360° 自由旋转：往上一直拖，镜头要能翻到模型底下，再拖回来回到原位
  viewer.setView('iso')
  await sleep(450)
  const box = canvas.getBoundingClientRect()
  const midX = box.left + box.width / 2
  const midY = box.top + box.height / 2
  const fire = (type, x, y) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: y
      })
    )
  const dragBy = async (step, times) => {
    let y = midY
    fire('pointerdown', midX, midY)
    for (let i = 0; i < times; i++) {
      y += step
      fire('pointermove', midX, y)
      await sleep(6)
    }
    fire('pointerup', midX, y)
    await sleep(240)
  }
  const startDir = test.camera().dir
  await dragBy(-20, 20) // 往上拖 400 px ≈ 183°
  const afterTumble = test.camera()
  const axisTumble = axisState()
  await dragBy(20, 20) // 原路拖回
  const backHome = test.camera()
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  // 再翻到下面停住，让截图拍到的是"从底下看"的样子
  await dragBy(-20, 20)
  const leftBelow = test.camera().dir[1] < -0.3

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
    axisLabels: axisBefore ? axisBefore.labels : null,
    axisTopLabels: axisTop ? axisTop.labels : null,
    // 俯视时模型 +Z 正对镜头，屏幕上缩成一个圆环；X 向右、Y 向上（CAD 习惯）
    axisTopZFlat: !!axisTop && Math.hypot(axisTop.lines[2].dx, axisTop.lines[2].dy) < 1,
    axisTopXRight: !!axisTop && axisTop.lines[0].dx > 10,
    axisTopYUp: !!axisTop && axisTop.lines[1].dy < -10 && Math.abs(axisTop.lines[1].dx) < 1,
    axisOff: axisOff,
    axisBackOn: axisBackOn,
    tumbleStartY: startDir[1],
    tumbleY: afterTumble.dir[1],
    tumbleBelow: afterTumble.dir[1] < -0.3,
    tumbleTurned: Math.abs(afterTumble.dir[1] - startDir[1]) > 0.5,
    tumbleAxisLabels: axisTumble ? axisTumble.labels : null,
    tumbleHome: dot3(backHome.dir, startDir) > 0.99,
    tumbleLeftBelow: leftBelow,
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
