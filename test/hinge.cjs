/**
 * "以圆为轴"的端到端：任意零件绕一条任意位置的轴线转。
 *
 * 跟 test/motion.cjs 一样在 Electron 主进程里起真 HTTP 服务，STEP 走真实宿主
 * worker 三角化。用法：
 *   <electron> test/hinge.cjs out.png [file] [partIndex]
 *
 * 默认跑 fixtures/cube.step 的第 0 个零件；要验证机臂那种"铰链不在零件中心"的
 * 情况，传真实装配体与机臂的零件下标，并用 HINGE_AXIS/Y/Z 环境变量给出铰链线，
 * 例如：
 *   HINGE_Y=7.7 HINGE_Z=-53.5 <electron> test/hinge.cjs arm.png ./_arm.step 1
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const { pathToFileURL } = require('url')

const OUT = process.argv[2] || path.join(os.tmpdir(), 'hinge.png')
const FILE = process.argv[3] || './fixtures/cube.step'
const PART = Number(process.argv[4] || 0)
const GRID = Number(process.env.GRID || 0.09)
const TIMEOUT = 180000

app.commandLine.appendSwitch('enable-unsafe-swiftshader')
app.commandLine.appendSwitch('use-gl', 'swiftshader')
app.commandLine.appendSwitch('allow-file-access-from-files')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(os.tmpdir(), 'dsh-stl-hinge-' + process.pid))

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

  const started = Date.now()
  let ready = false
  while (Date.now() - started < TIMEOUT) {
    ready = await win.webContents.executeJavaScript(
      `(() => { const s = document.querySelector('.dsh-stl-stats'); return !!(s && s.innerText.trim().length > 0) })()`
    )
    if (ready) break
    await sleep(400)
  }
  if (!ready) {
    console.log('HINGE ' + JSON.stringify({ ready: false }))
    app.exit(2)
    return
  }

  const hingeY = Number(process.env.HINGE_Y || 0)
  const hingeZ = Number(process.env.HINGE_Z || 0)

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
    const PART = ${PART}
    const HINGE = [0, ${hingeY}, ${hingeZ}]
    const AXIS = [1, 0, 0]

    const parts = viewer._test.parts() || []
    const stats = (document.querySelector('.dsh-stl-stats') || {}).innerText || ''

    press(/^(运动|Motion)$/)
    await sleep(120)
    const opened = !!panel()

    // 选中零件（列表点也行，这里直接用 API 免得依赖屏幕坐标）
    viewer._test.selectPart(PART)
    await sleep(80)
    const selected = viewer._test.motion().selected

    // 面板上的「以圆为轴」进入取圆模式，Esc 退出
    const hingeButton = () => panel() && panel().querySelector('.dsh-stl-hinge')
    const hingeButtonThere = !!hingeButton()
    if (hingeButton()) hingeButton().click()
    await sleep(80)
    const pickingOn = viewer._test.pivotPick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(80)
    const pickingOff = !viewer._test.pivotPick()

    // 真点一下：在孔壁那圈顶点（半径≈10）里找一个屏幕像素，先只读地确认这个
    // 像素上确实能认出圆，再走正常的"点击画布"路径 —— 这才是用户的手势。
    const canvas = document.querySelector('canvas')
    const rect = canvas.getBoundingClientRect()
    const flat = viewer._test.sampleVerts(PART, 3000) || []
    const radii = []
    for (let i = 0; i + 2 < flat.length; i += 3) {
      radii.push(Math.hypot(flat[i + 1] - HINGE[1], flat[i + 2] - HINGE[2]))
    }
    radii.sort((a, b) => a - b)
    const diag = {
      samples: radii.length,
      minRadius: radii.length ? radii[0] : null,
      medianRadius: radii.length ? radii[Math.floor(radii.length / 2)] : null,
      maxRadius: radii.length ? radii[radii.length - 1] : null,
      nearTen: radii.filter((r) => r > 9.4 && r < 10.6).length
    }

    // 先粗扫一遍画布，看这个装配体上到底能认出哪些圆（列出来便于挑轴）
    const circles = []
    const seen = new Set()
    const GRID = ${GRID}
    for (let gx = GRID / 2; gx < 1 && circles.length < 12; gx += GRID) {
      for (let gy = GRID / 2; gy < 1 && circles.length < 12; gy += GRID) {
        const c = viewer._test.pickCircleAt(rect.left + rect.width * gx, rect.top + rect.height * gy)
        if (!c) continue
        const key = c.radius.toFixed(2) + '@' + c.center.map((v) => v.toFixed(1)).join(',')
        if (seen.has(key)) continue
        seen.add(key)
        circles.push({
          radius: Number(c.radius.toFixed(2)),
          center: c.center.map((v) => Number(v.toFixed(1))),
          normal: c.normal.map((v) => Number(v.toFixed(2))),
          px: Math.round(rect.left + rect.width * gx),
          py: Math.round(rect.top + rect.height * gy)
        })
      }
    }

    // 舵盘外圆：圆心在前面的圆探针里是 (y,z)=(7.7,-53.5)、半径 9.9，
    // 盘面在 x=±21 附近。沿这圈取 16 个角度，投影成像素逐个试。
    let uiCircle = null
    let uiPicked = null
    let tried = 0
    // Esc 那一步如果关掉了运动面板，就重新打开、重新选中零件（取圆要用到选中零件）
    if (!viewer._test.motionMode()) {
      press(/^(运动|Motion)$/)
      await sleep(120)
      viewer._test.selectPart(PART)
      await sleep(80)
    }
    // 确保取圆模式是开着的（Esc 那一步可能没退干净，按钮再点会变成关）
    if (!viewer._test.pivotPick()) viewer._test.beginPivotPick()
    // 先试粗扫时真的认出来的那些圆（孔壁、圆边都算），这是用户会点的位置
    const trace = []
    for (const known of circles) {
      if (uiPicked) break
      tried++
      const px = known.px
      const py = known.py
      const pickBefore = viewer._test.pivotPick()
      const atPoint = viewer._test.pickCircleAt(px, py)
      let error = null
      try {
        canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: px, clientY: py }))
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: px, clientY: py }))
      } catch (e) {
        error = String(e && e.message)
      }
      await sleep(150)
      const afterClick = viewer._test.partHinge(PART)
      trace.push({
        px,
        py,
        pickBefore,
        atPoint: atPoint ? Number(atPoint.radius.toFixed(2)) : null,
        pickAfter: viewer._test.pivotPick(),
        axis: afterClick ? afterClick.axis : null,
        error
      })
      if (afterClick && afterClick.axis) {
        uiCircle = { center: known.center, normal: known.normal, radius: known.radius }
        uiPicked = afterClick
      }
    }
    for (const discX of [-21, 21]) {
      for (let k = 0; k < 16 && !uiCircle; k++) {
        const th = (k / 16) * Math.PI * 2
        const p = [discX, HINGE[1] + 9.9 * Math.cos(th), HINGE[2] + 9.9 * Math.sin(th)]
        const q = viewer._test.project(p)
        if (!q) continue
        const px = rect.left + q.x
        const py = rect.top + q.y
        tried++
        const found = viewer._test.pickCircleAt(px, py)
        if (!found) continue
        uiCircle = found
        canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: px, clientY: py }))
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: px, clientY: py }))
        await sleep(150)
        uiPicked = viewer._test.partHinge(PART)
      }
    }
    const uiPickedOk = !!(uiPicked && uiPicked.axis)
    const uiCircleOnAxis = uiCircle
      ? Math.hypot(uiCircle.center[1] - HINGE[1], uiCircle.center[2] - HINGE[2])
      : null

    // 换成用户真实的动作：在选中零件上随便点一下，看能不能自己找到铰链
    let partClick = null
    if (!uiPickedOk) {
      for (let gx = 0.15; gx < 0.9 && !partClick; gx += 0.03) {
        for (let gy = 0.15; gy < 0.9 && !partClick; gy += 0.03) {
          const px = Math.round(rect.left + rect.width * gx)
          const py = Math.round(rect.top + rect.height * gy)
          const hit = viewer._test.hitPart(px, py)
          if (!hit || hit.index !== PART) continue
          if (!viewer._test.pivotPick()) viewer._test.beginPivotPick()
          canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: px, clientY: py }))
          window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: px, clientY: py }))
          await sleep(150)
          const now = viewer._test.partHinge(PART)
          if (now && now.axis) {
            partClick = { px, py, hit: hit.point, pivot: now.pivot, axis: now.axis }
            uiPicked = now
            uiCircle = { center: now.pivot, normal: now.axis, radius: null }
          }
        }
      }
    }
    const uiPickedOk2 = !!(uiPicked && uiPicked.axis)

    // 兜底：如果这一帧认不到圆，至少用真实 API 装上舵机输出轴那条线
    if (!uiPickedOk2) viewer._test.setPartPivot(PART, HINGE, AXIS)
    await sleep(80)
    const pivot = viewer._test.partHinge(PART)
    const panelTextAfter = panel() ? panel().innerText : ''

    // 圆是一块面：整块零件都得绕这根轴转，到轴的距离一个都不能变。
    // 用"实际装上的 pivot + axis"来量，谁装的都一样准。
    const pv = pivot.pivot
    const av = pivot.axis
    const dist = (p) => {
      const d = [p[0] - pv[0], p[1] - pv[1], p[2] - pv[2]]
      const along = d[0] * av[0] + d[1] * av[1] + d[2] * av[2]
      return Math.hypot(d[0] - along * av[0], d[1] - along * av[1], d[2] - along * av[2])
    }
    const before = viewer._test.sampleVerts(PART, 400)
    viewer._test.rotatePartBy(PART, 0.55)
    await sleep(120)
    const after = viewer._test.sampleVerts(PART, 400)
    let worst = 0
    let moved = 0
    for (let i = 0; i + 2 < before.length; i += 3) {
      const a = [before[i], before[i + 1], before[i + 2]]
      const b = [after[i], after[i + 1], after[i + 2]]
      worst = Math.max(worst, Math.abs(dist(a) - dist(b)))
      moved = Math.max(moved, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]))
    }
    const radiusKept = parts[PART] ? dist(parts[PART].center) : 0

    // 清掉轴，应回到包围盒中心
    viewer._test.clearPartPivot(PART)
    await sleep(60)
    const cleared = viewer._test.partHinge(PART).axis === null

    // 出图：散开一点、等轴、把这一臂转开 35 度
    viewer._test.setPartSpin(PART, 0)
    viewer._test.setPartPivot(PART, HINGE, AXIS)
    viewer._test.rotatePartBy(PART, 0.6)
    viewer._test.setExplode(0.35)
    if (viewer.setView) viewer.setView('iso')
    await sleep(420)

    return {
      stats,
      parts: parts.length,
      opened,
      selected,
      hingeButtonThere,
      pickingOn,
      pickingOff,
      pivot: pivot ? pivot.pivot : null,
      axis: pivot ? pivot.axis : null,
      panelSaysCircleAxis: /圆的轴|circle axis/.test(panelTextAfter),
      hingeRadius: radiusKept,
      worstRadiusDrift: worst,
      moved,
      cleared,
      uiCircleRadius: uiCircle ? uiCircle.radius : null,
      uiCircleNormal: uiCircle ? uiCircle.normal : null,
      uiCircleOnAxis,
      uiPickedOk,
      uiPickedPivot: uiPicked ? uiPicked.pivot : null,
      partClick,
      uiPickedOk2,
      uiTried: tried,
      trace,
      circles,
      diag
    }
  })()`)

  const image = await win.capturePage()
  fs.writeFileSync(OUT, image.toPNG())
  console.log('HINGE ' + JSON.stringify(result))
  console.log('WROTE ' + OUT + ' ' + fs.statSync(OUT).size)
  server.close()
  app.exit(0)
})
