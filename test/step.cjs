/**
 * STEP 端到端：宿主半侧 + 客户端半侧一起跑。
 *
 * 这个脚本在 Electron 主进程里起一个真的 HTTP 服务：
 *   - 静态文件（harness.html、fixtures、lib、node_modules）
 *   - /dsh-stl-viewer/convert  直接挂 lib/index.js 注册的那个 handler
 * 于是浏览器里的 client.js 用真实的 fetch 把 STEP 字节 POST 过去，
 * 宿主用真的 worker + OpenCascade 三角化，回来渲染。
 *
 * 用法：
 *   <electron> test/step.cjs out.png [file]
 * 默认 file = ./fixtures/cube.step（20 mm 立方体，应当 12 个三角面）。
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const { pathToFileURL } = require('url')

const OUT = process.argv[2] || path.join(os.tmpdir(), 'step.png')
const FILE = process.argv[3] || './fixtures/cube.step'
const TIMEOUT = 90000

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
      // 其余按 test/ 下的相对路径处理，方便临时挂一个真模型（test/_xxx.step）
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
  let state = null
  while (Date.now() - started < TIMEOUT) {
    state = await win.webContents.executeJavaScript(`(() => {
      const stats = document.querySelector('.dsh-stl-stats')
      const converting = document.querySelector('.dsh-stl-converting')
      const root = document.querySelector('.dsh-stl-viewer')
      const canvas = document.querySelector('canvas')
      const text = root ? root.innerText.replace(/\\s+/g, ' ').trim() : ''
      return {
        mounted: !!window.__mounted,
        hasCanvas: !!canvas,
        stats: stats ? stats.innerText.replace(/\\s+/g, ' ').trim() : '',
        converting: converting ? converting.innerText.replace(/\\s+/g, ' ').trim() : '',
        error: stats || canvas ? '' : text,
        viewer: null
      }
    })()`)
    if (state && (state.stats.length > 0 || state.error.length > 0)) break
    await sleep(400)
  }

  const elapsed = Date.now() - started
  const image = await win.webContents.capturePage()
  fs.writeFileSync(OUT, image.toPNG())

  console.log(
    'STEP ' +
      JSON.stringify(
        {
          file: FILE,
          ms: elapsed,
          mounted: state && state.mounted,
          hasCanvas: state && state.hasCanvas,
          stats: state && state.stats,
          converting: state && state.converting,
          error: state && state.error
        },
        null,
        0
      )
  )
  console.log('WROTE ' + OUT + ' ' + fs.statSync(OUT).size)

  server.close()
  win.destroy()
  app.quit()
})

process.on('unhandledRejection', (error) => {
  console.error('FAILED ' + (error && error.stack ? error.stack : error))
  process.exitCode = 1
  app.quit()
})
