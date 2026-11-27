/**
 * 宿主半侧的单元测试：不开 DSH、不开浏览器，只把 lib/index.js 当成普通模块跑。
 *
 * 假 ctx 提供两样东西 —— webServer.register 收路由、effect 收清理函数 ——
 * 然后直接拿真实 STEP 文件去调转换路由，解包二进制并核对几何：
 * 20 mm 立方体应当正好 12 个三角面、长宽高各 20、体积 8000 mm³。
 *
 * 需要 occt-import-js（package.json 的 dependencies）已安装：
 *   npm install
 * 用法：
 *   node test/host.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const { name, apply, conversionBudget } = await import(new URL('../lib/index.js', import.meta.url).href)

/** 收集路由的假 ctx。 */
function fakeContext() {
  const routes = new Map()
  const disposers = []
  return {
    routes,
    ctx: {
      effect(fn) {
        disposers.push(fn())
      },
      // Cordis 的依赖等待：服务已在时才回调，这里同步给到同一个 ctx。
      inject(deps, callback) {
        callback(this)
        return () => {}
      },
      webServer: {
        register(route) {
          routes.set(route.path, route)
          return () => routes.delete(route.path)
        }
      },
      logger: () => ({ info() {}, warn() {}, debug() {} })
    },
    dispose() {
      for (const fn of disposers) if (typeof fn === 'function') fn()
    }
  }
}

/** 把字节做成 Node 风格的请求对象。 */
function fakeRequest(method, bytes, name, url) {
  const stream = Readable.from(bytes ? [bytes] : [])
  stream.method = method
  stream.headers = name ? { 'x-dsh-stl-name': name } : {}
  stream.url = url || '/dsh-stl-viewer/convert'
  return stream
}

/** 收集 Node 风格响应。 */
function fakeResponse() {
  const captured = { status: 0, headers: {}, body: null }
  return {
    captured,
    writeHead(status, headers) {
      captured.status = status
      captured.headers = headers || {}
    },
    end(chunk) {
      captured.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0)
    }
  }
}

const silent = () => ({ info() {}, warn() {}, debug() {} })

/**
 * 解包 'DSHM' 网格。
 */
function decode(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const magic = view.getUint32(0, true)
  const version = view.getUint32(4, true)
  const count = view.getUint32(8, true)
  const parts = view.getUint32(12, true)
  assert.equal(magic, 0x4d485344, 'magic should be DSHM')
  assert.equal(version, 2, 'format version')
  const tableLength = view.getUint32(16, true)
  const offset = 20 + ((tableLength + 3) & ~3)
  assert.equal(buffer.byteLength, offset + count * 36, 'packed length')
  const table = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer.buffer, buffer.byteOffset + 20, tableLength)).replace(/\u0000+$/, '')
  )
  assert.equal(table.parts.length, parts, 'part table length')
  const positions = new Float32Array(buffer.buffer, buffer.byteOffset + offset, count * 9)
  return { count, parts, names: table.parts, positions }
}

/** 散度定理求体积（mm³）。 */
function volume(positions, count) {
  let sum = 0
  for (let i = 0; i < count; i += 1) {
    const o = i * 9
    const ax = positions[o]
    const ay = positions[o + 1]
    const az = positions[o + 2]
    const bx = positions[o + 3]
    const by = positions[o + 4]
    const bz = positions[o + 5]
    const cx = positions[o + 6]
    const cy = positions[o + 7]
    const cz = positions[o + 8]
    sum += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
  }
  return Math.abs(sum) / 6
}

function bounds(positions) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], positions[i + k])
      max[k] = Math.max(max[k], positions[i + k])
    }
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
}

test('the host half registers a convert route and a health route', () => {
  const { ctx, routes } = fakeContext()
  apply(ctx)
  assert.equal(name, 'dsh-stl-viewer')
  assert.ok(routes.has('/dsh-stl-viewer/convert'), 'convert route')
  assert.ok(routes.has('/dsh-stl-viewer/step'), 'health route')
  assert.equal(routes.get('/dsh-stl-viewer/convert').kind, 'exact')
})

test('health returns the formats and the size cap', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx)
  const response = fakeResponse()
  await routes.get('/dsh-stl-viewer/step').handler(fakeRequest('GET'), response)
  assert.equal(response.captured.status, 200)
  const body = JSON.parse(String(response.captured.body))
  assert.equal(body.ok, true)
  assert.deepEqual(body.formats.sort(), ['brep', 'iges', 'igs', 'step', 'stp'])
  assert.ok(body.maxBytes >= 64 * 1024 * 1024)
})

test('convert rejects anything but POST', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx)
  const response = fakeResponse()
  await routes.get('/dsh-stl-viewer/convert').handler(fakeRequest('GET'), response)
  assert.equal(response.captured.status, 405)
  assert.equal(response.captured.headers.allow, 'POST')
})

test('a 20 mm STEP cube comes back as 12 triangles of the right size', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx)
  const bytes = readFileSync(join(root, 'test', 'fixtures', 'cube.step'))

  // 先把这个文件从磁盘缓存里摘掉，让本次真的走一遍 OpenCascade。
  const health = fakeResponse()
  await routes.get('/dsh-stl-viewer/step').handler(fakeRequest('GET'), health)
  const cacheDir = JSON.parse(String(health.captured.body)).cacheDir
  const key = createHash('sha1').update(bytes).digest('hex')
  try {
    unlinkSync(join(cacheDir, key + '.dsm'))
  } catch (error) {
    // 本来就没有
  }

  const response = fakeResponse()
  await routes
    .get('/dsh-stl-viewer/convert')
    .handler(fakeRequest('POST', bytes, 'cube.step'), response)

  assert.equal(response.captured.status, 200, String(response.captured.body))
  assert.equal(response.captured.headers['content-type'], 'application/octet-stream')
  assert.equal(response.captured.headers['x-dsh-stl-tris'], '12')

  const { count, parts, positions, names } = decode(response.captured.body)
  assert.equal(count, 12, 'a cube tessellates to 12 triangles')
  assert.ok(parts >= 1, 'at least one part')
  // 每个面是独立的 Solid，所以立方体会被拆成 6 个零件；零件表要真的带上范围
  assert.equal(names.length, parts, 'one table row per part')
  let covered = 0
  for (const row of names) {
    assert.ok(typeof row.start === 'number' && row.count > 0, 'part range ' + JSON.stringify(row))
    covered += row.count
  }
  assert.equal(covered, count, 'the rows cover every triangle')
  const dims = bounds(positions)
  for (const d of dims) assert.ok(Math.abs(d - 20) < 0.01, 'dimension ' + d + ' should be 20')
  const vol = volume(positions, count)
  assert.ok(Math.abs(vol - 8000) < 1, 'volume ' + vol + ' should be 8000 mm³')
})

test('the second request for the same bytes is served from cache', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx)
  const bytes = readFileSync(join(root, 'test', 'fixtures', 'cube.step'))
  const route = routes.get('/dsh-stl-viewer/convert')

  const first = fakeResponse()
  await route.handler(fakeRequest('POST', bytes, 'cube.step'), first)
  const started = Date.now()
  const second = fakeResponse()
  await route.handler(fakeRequest('POST', bytes, 'cube.step'), second)
  const elapsed = Date.now() - started

  assert.equal(second.captured.status, 200)
  assert.equal(second.captured.body.length, first.captured.body.length)
  assert.ok(second.captured.body.equals(first.captured.body), 'same bytes')
  assert.ok(elapsed < 200, 'cache hit took ' + elapsed + ' ms')
})

test('the mesh is written to the disk cache', async () => {
  const bytes = readFileSync(join(root, 'test', 'fixtures', 'cube.step'))
  const key = createHash('sha1').update(bytes).digest('hex')

  const { ctx, routes } = fakeContext()
  apply(ctx)

  const health = fakeResponse()
  await routes.get('/dsh-stl-viewer/step').handler(fakeRequest('GET'), health)
  const info = JSON.parse(String(health.captured.body))
  assert.ok(info.cacheDir, 'health names the cache directory')

  // 真实用户的缓存目录里可能已经有别的零件，只认这份字节的 sha1
  const file = join(info.cacheDir, key + '.dsm')
  try {
    unlinkSync(file)
  } catch (error) {
    // 本来就没有
  }

  const response = fakeResponse()
  await routes.get('/dsh-stl-viewer/convert').handler(fakeRequest('POST', bytes, 'cube.step'), response)
  assert.equal(response.captured.status, 200)

  // 转换是异步落盘的，给它一点时间；文件应当以 DSHM 头开头。
  let first = null
  for (let attempt = 0; attempt < 80 && !first; attempt++) {
    try {
      first = readFileSync(file)
    } catch (error) {
      await new Promise((done) => setTimeout(done, 25))
    }
  }
  assert.ok(first, 'cache file ' + file)
  assert.equal(first.toString('latin1', 0, 4), 'DSHM')
  assert.equal(first.length, response.captured.body.length)
})

test('a fresh context, as after a restart, is served from the disk cache', async () => {
  const bytes = readFileSync(join(root, 'test', 'fixtures', 'cube.step'))
  const warm = fakeContext()
  apply(warm.ctx)
  const first = fakeResponse()
  await warm.routes.get('/dsh-stl-viewer/convert').handler(fakeRequest('POST', bytes, 'cube.step'), first)
  assert.equal(first.captured.status, 200)

  // 等落盘
  const health = fakeResponse()
  await warm.routes.get('/dsh-stl-viewer/step').handler(fakeRequest('GET'), health)
  const cacheDir = JSON.parse(String(health.captured.body)).cacheDir
  for (let attempt = 0; attempt < 40; attempt++) {
    let found = false
    try {
      found = readdirSync(cacheDir).some((name) => name.endsWith('.dsm'))
    } catch (error) {
      found = false
    }
    if (found) break
    await new Promise((done) => setTimeout(done, 25))
  }

  const cold = fakeContext()
  apply(cold.ctx)
  const started = Date.now()
  const second = fakeResponse()
  await cold.routes.get('/dsh-stl-viewer/convert').handler(fakeRequest('POST', bytes, 'cube.step'), second)
  const elapsed = Date.now() - started

  assert.equal(second.captured.status, 200)
  assert.equal(second.captured.headers['x-dsh-stl-tris'], '12')
  assert.ok(second.captured.body.equals(first.captured.body), 'same bytes as the fresh conversion')
  assert.ok(elapsed < 400, 'disk hit took ' + elapsed + ' ms')
})

test('the time budget grows with the file, so a 116 MB assembly is not cut off', () => {
  // 小文件仍给十分钟：少于这个数就没必要按体积算。
  assert.equal(conversionBudget(1024 * 1024), 10 * 60 * 1000)
  // 116 MB 要二十分钟以上，二十秒一兆给到三十九分钟。
  assert.equal(conversionBudget(116 * 1024 * 1024), 116 * 20 * 1000)
  assert.ok(conversionBudget(200 * 1024 * 1024) > conversionBudget(50 * 1024 * 1024))
  assert.equal(conversionBudget(0), 10 * 60 * 1000)
})

test('a request whose panel already went away comes back as 499', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx)
  const bytes = readFileSync(join(root, 'test', 'fixtures', 'cube.step'))

  // 浏览器关掉面板时 fetch 会断开，Node 这一侧的 socket 就是 destroyed。
  const request = fakeRequest('POST', bytes, 'cube.step', '/dsh-stl-viewer/convert?ext=step')
  request.socket = { destroyed: true }
  const response = fakeResponse()
  await routes.get('/dsh-stl-viewer/convert').handler(request, response)
  assert.equal(response.captured.status, 499)
})

test('a file that is not STEP data fails with a JSON error', async () => {  const { ctx, routes } = fakeContext()
  apply(ctx)
  const response = fakeResponse()
  await routes
    .get('/dsh-stl-viewer/convert')
    .handler(fakeRequest('POST', Buffer.from('this is not a step file'), 'nope.step'), response)
  assert.equal(response.captured.status, 500)
  const body = JSON.parse(String(response.captured.body))
  assert.ok(body.error.length > 0)
})

test('the format comes from ?ext=, not from the file name', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx)
  const bytes = readFileSync(join(root, 'test', 'fixtures', 'cube.step'))

  // 同一份 STEP 字节：说自己是 step 就成功，说自己是 iges 就该被 OCCT 拒掉。
  // 这也说明客户端为什么只发扩展名——文件名可以是中文，header 发不出去。
  const good = fakeResponse()
  await routes
    .get('/dsh-stl-viewer/convert')
    .handler(fakeRequest('POST', bytes, '桨罩大轮.step', '/dsh-stl-viewer/convert?ext=step'), good)
  assert.equal(good.captured.status, 200)

  // 换一个字节串，免得撞上按 SHA-1 的缓存：缓存只认字节，不认 format。
  const other = Buffer.concat([bytes, Buffer.from('\n')])
  const wrong = fakeResponse()
  await routes
    .get('/dsh-stl-viewer/convert')
    .handler(fakeRequest('POST', other, '', '/dsh-stl-viewer/convert?ext=iges'), wrong)
  assert.equal(wrong.captured.status, 500)
})

