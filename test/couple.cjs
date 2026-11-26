/**
 * 齿轮联动的端到端：真装配体（两个大轮 + 一个驱动齿轮）走真实的宿主 worker 三角化，
 * 然后：
 *   1) describeGears 应该认出两对啮合，传动比 ≈ 5.25；
 *   2) 联动打开时给小齿轮一个转速，两个大轮要按 1 : 5.25 反向转起来；
 *   3) 联动关掉后，大轮必须停在那里不动。
 *
 * 用法：
 *   <electron> test/couple.cjs out.png [file]
 * 默认 file = ./_asm.step（装配_双大轮_单齿.step 的副本，两个大轮 + 中心距 200 的小齿）。
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const { pathToFileURL } = require('url')

const OUT = process.argv[2] || path.join(os.tmpdir(), 'couple.png')
const FILE = process.argv[3] || './_asm.step'
const TIMEOUT = 180000

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
    const panel = () => document.querySelector('.dsh-stl-motion')
    const press = (re) => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const button = buttons.find((b) => re.test(b.innerText.trim()))
      if (!button) throw new Error('no button matching ' + re)
      button.click()
      return button
    }

    const out = { stats: (document.querySelector('.dsh-stl-stats') || {}).innerText || '' }
    out.parts = viewer._test.parts().map((p) => ({ index: p.index, radius: p.radius, axis: p.axis }))

    // 1) 啮合识别
    const gears = viewer._test.gears()
    out.pairs = gears.pairs.map((p) => ({ a: p.a, b: p.b, ratio: Number(p.ratio.toFixed(4)) }))

    // 2) 打开运动面板，给小齿轮一个转速
    press(/^(运动|Motion)$/)
    await sleep(120)
    out.panel = !!panel()
    out.panelText = panel() ? panel().innerText.replace(/\\n/g, ' | ') : ''
    out.statePairs = viewer._test.motion().gears.pairs.length
    out.ratioLabel = panel() ? (panel().innerText.match(/1 : [0-9.]+/) || [''])[0] : ''

    const byRadius = viewer._test.parts().slice().sort((a, b) => a.radius - b.radius)
    const pinion = byRadius[0].index
    const wheels = byRadius.slice(1).map((p) => p.index)
    out.pinion = pinion

    const angles = () => viewer._test.parts().map((p) => viewer._test.partAngle(p.index))
    const before = angles()
    viewer._test.setPartSpin(pinion, 1) // 每秒 1 转
    await sleep(900)
    const after = angles()
    const delta = after.map((v, i) => v - before[i])
    out.delta = delta.map((v) => Number(v.toFixed(4)))
    out.pinionDelta = Number(delta[pinion].toFixed(4))
    out.wheelDeltas = wheels.map((i) => Number(delta[i].toFixed(4)))
    out.turnedTogether = wheels.every((i) => Math.abs(delta[i]) > 0.2)
    out.opposite = wheels.every((i) => Math.sign(delta[i]) === -Math.sign(delta[pinion]))
    out.ratioMeasured = Number((Math.abs(delta[pinion]) / Math.abs(delta[wheels[0]])).toFixed(3))
    out.wheelsEqual = Math.abs(Math.abs(delta[wheels[0]]) - Math.abs(delta[wheels[1]])) < 0.05

    // 3) 填上齿数（168 / 168 / 32）：传动比应该变成精确的 5.25
    wheels.forEach((i) => viewer._test.setPartTeeth(i, 168))
    viewer._test.setPartTeeth(pinion, 32)
    viewer._test.setPartSpin(pinion, 1)
    await sleep(60)
    const before3 = angles()
    await sleep(800)
    const after3 = angles()
    const delta3 = after3.map((v, i) => v - before3[i])
    out.withTeeth = {
      pairs: viewer._test.gears().pairs.map((p) => Number(p.ratio.toFixed(4))),
      pinion: Number(delta3[pinion].toFixed(3)),
      wheels: wheels.map((i) => Number(delta3[i].toFixed(3))),
      ratio: Math.abs(delta3[wheels[0]]) > 1e-6
        ? Number((Math.abs(delta3[pinion]) / Math.abs(delta3[wheels[0]])).toFixed(3))
        : 0
    }

    // 4) 关掉联动：小齿轮还要转，大轮必须不动
    viewer._test.setCoupled(false)
    viewer._test.resetMotion()
    await sleep(60)
    const before2 = angles()
    viewer._test.setPartSpin(pinion, 1)
    await sleep(700)
    const after2 = angles()
    const delta2 = after2.map((v, i) => v - before2[i])
    out.uncoupled = {
      pinion: Number(delta2[pinion].toFixed(3)),
      wheels: wheels.map((i) => Number(delta2[i].toFixed(3))),
      wheelsStill: wheels.every((i) => Math.abs(delta2[i]) < 0.05)
    }

    // 5) 再打开联动（齿数已经填好），大轮应该按 5.25 跟着转
    viewer._test.setCoupled(true)
    viewer._test.setPartSpin(pinion, 1)
    await sleep(80)
    const before4 = angles()
    await sleep(700)
    const after4 = angles()
    const delta4 = after4.map((v, i) => v - before4[i])
    out.recoupled = {
      pinion: Number(delta4[pinion].toFixed(3)),
      wheels: wheels.map((i) => Number(delta4[i].toFixed(3))),
      ratio: Math.abs(delta4[wheels[0]]) > 1e-6
        ? Number((Math.abs(delta4[pinion]) / Math.abs(delta4[wheels[0]])).toFixed(3))
        : 0,
      speeds: viewer._test.parts().map((p) => Number(p.speed.toFixed(3))),
      coupledFlag: viewer._test.motion().coupled,
      pairsAtEnd: viewer._test.gears().pairs.length
    }

    // 5) 截图：散开一点，让两轮和小齿都看得见
    viewer._test.setExplode(0.55)
    viewer.setView('iso')
    await sleep(500)
    out.shot = { explode: viewer._test.explode(), selected: viewer._test.motion().selected }
    return out
  })()`)

  console.log('COUPLE ' + JSON.stringify(result))
  await sleep(400)
  const image = await win.webContents.capturePage()
  fs.writeFileSync(OUT, image.toPNG())
  console.log('WROTE ' + OUT + ' ' + fs.statSync(OUT).size)
  server.close()
  app.exit(0)
})
