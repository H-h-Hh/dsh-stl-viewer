/**
 * 装配体运动的端到端：分解 + 单零件自转。
 *
 * 跟 test/step.cjs 一样在 Electron 主进程里起一个真的 HTTP 服务，
 * 所以 STEP 会走真实的宿主 worker 三角化，零件表也是真的。
 *
 * 用法：
 *   <electron> test/motion.cjs out.png [file]
 * 默认 file = ./fixtures/cube.step（立方体的 6 个面正好是 6 个零件，
 * 分解时能明显看到它们推开；真装配体可以传 test/_xxx.step）。
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const { pathToFileURL } = require('url')

const OUT = process.argv[2] || path.join(os.tmpdir(), 'motion.png')
const FILE = process.argv[3] || './fixtures/cube.step'
const TIMEOUT = 120000

app.commandLine.appendSwitch('enable-unsafe-swiftshader')
app.commandLine.appendSwitch('use-gl', 'swiftshader')
app.commandLine.appendSwitch('allow-file-access-from-files')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(os.tmpdir(), 'dsh-stl-shoot-' + process.pid))

const repo = path.join(__dirname, '..')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.stl': 'application/octet-stream',
  '.step': 'text/plain; charset=utf-8',
  '.stp': 'text/plain; charset=utf-8'
}

async function startServer() {
  const { apply } = await import(pathToFileURL(path.join(repo, 'lib', 'index.js')).href)
  const routes = new Map()
  apply({
    effect(fn) {
      fn()
    },
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => {}
      }
    },
    logger: () => ({ info() {}, warn() {}, debug() {} })
  })
  const convert = routes.get('/dsh-stl-viewer/convert')

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/dsh-stl-viewer/convert') {
      convert.handler(request, response)
      return
    }
    let file = null
    if (url.pathname === '/' || url.pathname === '/harness.html') file = path.join(__dirname, 'harness.html')
    else if (url.pathname.startsWith('/fixtures/')) file = path.join(__dirname, url.pathname.slice(1))
    else if (url.pathname.startsWith('/node_modules/')) file = path.join(__dirname, url.pathname.slice(1))
    else if (url.pathname.startsWith('/lib/')) file = path.join(repo, url.pathname.slice(1))
    else {
      const candidate = path.join(__dirname, decodeURIComponent(url.pathname.slice(1)))
      if (candidate.startsWith(__dirname)) file = candidate
    }
    if (!file) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        response.writeHead(404)
        response.end(String(error))
        return
      }
      response.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
      response.end(data)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  const { server, port } = await startServer()
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: { offscreen: true, contextIsolation: false }
  })

  const url = 'http://127.0.0.1:' + port + '/harness.html?file=' + encodeURIComponent(FILE)
  await win.loadURL(url)

  // 等几何就位
  const started = Date.now()
  let ready = false
  while (Date.now() - started < TIMEOUT) {
    ready = await win.webContents.executeJavaScript(
      `(() => { const s = document.querySelector('.dsh-stl-stats'); return !!(s && s.innerText.trim().length > 0) })()`
    )
    if (ready) break
    await sleep(400)
  }

  const result = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const viewer = document.querySelector('canvas').__dshStlViewer
    const press = (re) => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const button = buttons.find((b) => re.test(b.innerText.trim()))
      if (!button) throw new Error('no button matching ' + re)
      button.click()
      return button
    }
    const panel = () => document.querySelector('.dsh-stl-motion')

    const before = {
      stats: (document.querySelector('.dsh-stl-stats') || {}).innerText || '',
      parts: viewer._test.parts() ? viewer._test.parts().length : 0
    }

    // 1) 打开运动面板
    const motionButton = press(/^(运动|Motion)$/)
    await sleep(120)
    const opened = !!panel()
    const rows = panel() ? panel().querySelectorAll('.dsh-stl-part').length : 0

    // 2) 在模型上点一下就能选中零件（沿用"没拖动才算点击"的判定）
    const canvas = document.querySelector('canvas')
    const rect = canvas.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: cx, clientY: cy }))
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: cx, clientY: cy }))
    await sleep(80)
    const clickSelects = viewer._test.motion().selected >= 0

    // 3) 分解：拖到 100%
    const slider = panel() && panel().querySelector('.dsh-stl-explode')
    const firstVertexBefore = viewer._test.vertices(0)
    if (slider) {
      slider.value = '100'
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await sleep(160)
    const exploded = viewer._test.explode()
    const firstVertexAfter = viewer._test.vertices(0)
    const moved = firstVertexBefore && firstVertexAfter
      ? Math.max(...firstVertexAfter.map((v, i) => Math.abs(v - firstVertexBefore[i])))
      : 0

    // 3) 选一个零件并给它转速（只有一个零件时也允许，转的就是整块）
    if (rows > 0) {
      const current = viewer._test.motion().selected
      const pick = rows > 1 ? (current === 0 ? 1 : 0) : 0
      panel().querySelectorAll('.dsh-stl-part')[pick].click()
      await sleep(80)
    }
    const selected = viewer._test.motion().selected
    const speedSlider = panel() && panel().querySelector('.dsh-stl-speed')
    if (speedSlider) {
      speedSlider.value = '60'
      speedSlider.dispatchEvent(new Event('input', { bubbles: true }))
      speedSlider.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const angleBefore = selected >= 0 ? viewer._test.partAngle(selected) : null
    await sleep(700)
    const angleAfter = selected >= 0 ? viewer._test.partAngle(selected) : null
    const spinning = viewer._test.motion().parts.filter((p) => p.spinning).length

    // 4) 换回转轴：选 Z
    const axisSelect = panel() && panel().querySelector('.dsh-stl-axis-pick')
    if (axisSelect) {
      axisSelect.value = '2'
      axisSelect.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const axisAfter = selected >= 0 ? viewer._test.parts()[selected].axis : null

    // 5) 全部复位
    press(/^(全部复位|Reset all)$/)
    await sleep(150)
    const afterReset = {
      explode: viewer._test.explode(),
      angles: viewer._test.parts().map((p) => Math.round(p.angle * 1000) / 1000),
      selected: viewer._test.motion().selected
    }

    // 6) Esc 关掉面板
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(120)
    const closedByEsc = !panel()

    // 7) 回到"散开、有零件在转、面板开着"的样子，留给截图
    press(/^(运动|Motion)$/)
    await sleep(120)
    const shotSlider = panel() && panel().querySelector('.dsh-stl-explode')
    if (shotSlider) {
      shotSlider.value = '70'
      shotSlider.dispatchEvent(new Event('input', { bubbles: true }))
    }
    viewer._test.setPartSpin(0, 0.4)
    if (rows > 1) viewer._test.setPartSpin(1, -0.5)
    if (rows > 0) panel().querySelectorAll('.dsh-stl-part')[0].click()
    await sleep(420)

    return {
      stats: before.stats,
      parts: before.parts,
      motionButton: !!motionButton,
      opened,
      rows,
      clickSelects,
      exploded,
      moved: Math.round(moved * 1000) / 1000,
      selected,
      angleBefore,
      angleAfter,
      spun: angleBefore !== null && angleAfter !== null ? Math.abs(angleAfter - angleBefore) : null,
      spinning,
      axisAfter,
      afterReset,
      singlePartExplodeStaysZero: before.parts < 2 ? exploded === 0 : null,
      closedByEsc,
      shot: { explode: viewer._test.explode(), selected: viewer._test.motion().selected }
    }
  })()`)

  const image = await win.webContents.capturePage()
  fs.writeFileSync(OUT, image.toPNG())
  console.log('MOTION ' + JSON.stringify(result))
  console.log('WROTE ' + OUT + ' ' + fs.statSync(OUT).size)
  server.close()
  app.exit(0)
})
