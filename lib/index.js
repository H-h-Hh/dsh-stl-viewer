/**
 * dsh-stl-viewer — 宿主半侧（Node / DSH 服务进程）。
 *
 * STL 不需要宿主做任何事：字节由 dsh-better-sidebar 的 mediaUrl 路由直接喂给
 * 浏览器，解析与渲染全在 lib/client.js 里。但 STEP（以及 IGES / BREP）是 B-rep
 * 格式，浏览器里没法直接变成三角面，所以这里提供一个转换路由：
 *
 *   GET  /dsh-stl-viewer/step      健康检查，返回版本与体积上限
 *   POST /dsh-stl-viewer/convert   请求体是 STEP 字节，返回打包好的网格
 *
 * 转换在 worker 线程里用 occt-import-js（OpenCascade 的 WASM 构建）完成，
 * 主线程不卡；同一个文件（按 sha1）会命中内存缓存，第二次打开是瞬间的。
 *
 * 返回的二进制格式（小端）：
 *   字节 0..4   'DSHM'（0x4d485344）
 *   字节 4..8   u32 版本，目前是 1
 *   字节 8..12  u32 三角面数
 *   字节 12..16 u32 零件数
 *   之后       三角面数 × 9 个 float32（每个面的三个顶点，模型原始单位、Z 向上）
 *
 * 路由只做格式转换，不回传原始字节；同一个页面发起的同源请求由 DSH 的 Web
 * 服务决定是否放行（与 /sidebar/* 一致）。
 */
import { Worker } from 'node:worker_threads'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-stl-viewer'

const CONVERT_PATH = '/dsh-stl-viewer/convert'
const HEALTH_PATH = '/dsh-stl-viewer/step'

/** 一次转换能接受的字节数。97 MB 的装配文件仍可打开，但会很慢。 */
const MAX_BYTES = 128 * 1024 * 1024
/** 内存缓存：最多几条、总共多少字节。 */
const CACHE_ENTRIES = 8
const CACHE_BYTES = 192 * 1024 * 1024
/** 单次转换的最低预算。小文件也用不着更多，慢了就是出错了。 */
const MIN_TIMEOUT_MS = 10 * 60 * 1000
/**
 * 每 MB 追加的预算。B-rep 解析是单线程 WASM，实测每秒 1–2 MB，而装配体里的
 * 拓扑又多，116 MB 的那套要二十分钟以上——所以预算按体积线性放大，而不是写死。
 */
const PER_MB_TIMEOUT_MS = 20 * 1000
/**
 * 磁盘缓存：OpenCascade 解析 B-rep 是每秒 1–2 MB 的活，一个 6 MB 的钢网要十几秒。
 * 把结果按内容 SHA-1 存到临时目录，重启 DSH 后仍是秒开。
 */
const CACHE_DIR = join(tmpdir(), 'dsh-stl-viewer-cache')
const DISK_ENTRIES = 24
const DISK_BYTES = 512 * 1024 * 1024

/** 三角面细分参数：相对包围盒的比例，数越小越细。 */
const PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.0012,
  angularDeflection: 0.3
}

const EXT_FORMAT = {
  step: 'step',
  stp: 'step',
  iges: 'iges',
  igs: 'iges',
  brep: 'brep'
}

/**
 * 把请求体读成 Buffer，并在超限时立刻停下。
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<Buffer>}
 */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      request.destroy()
      reject(error)
    }
    request.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BYTES) {
        fail(Object.assign(new Error('file too large'), { code: 'TOO_LARGE' }))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
    request.on('aborted', () => fail(new Error('request aborted')))
    request.on('error', (error) => fail(error))
  })
}

/** 常驻的转换 worker：初始化和 WASM 加载每次要 50–120 ms，留着复用。 */
let slot = null

/** 把 worker 标记为坏掉，并把当前任务叫醒。 */
function failSlot(target, error) {
  target.dead = true
  if (slot === target) slot = null
  try {
    target.worker.terminate()
  } catch (error) {
    // 已经没了
  }
  const job = target.job
  target.job = null
  if (job) {
    clearTimeout(job.timer)
    job.reject(error)
  }
}

/** 取当前 worker，必要时起一个。 */
function ensureSlot() {
  if (slot) return slot
  const worker = new Worker(new URL('./convert.worker.mjs', import.meta.url))
  const created = { worker, job: null, dead: false }
  worker.on('message', (msg) => {
    const job = created.job
    created.job = null
    if (!job) return
    clearTimeout(job.timer)
    if (msg && msg.ok) {
      job.resolve({
        buffer: Buffer.from(msg.buffer),
        tris: msg.tris,
        parts: msg.parts,
        ms: msg.ms
      })
      return
    }
    job.reject(new Error((msg && msg.error) || 'conversion failed'))
  })
  worker.on('error', (error) => failSlot(created, error))
  worker.on('exit', (code) => {
    if (!created.dead && code !== 0) failSlot(created, new Error('converter exited with code ' + code))
    else if (slot === created) slot = null
  })
  // 空闲时不拖住进程退出
  if (typeof worker.unref === 'function') worker.unref()
  slot = created
  return created
}

/**
 * 在常驻 worker 里跑一次转换；调用方（串行队列）保证同时只有一个任务。
 *
 * 面板被关掉或页面刷新时，浏览器那一侧的 fetch 会断开，但 worker 不会自己
 * 停下来——不看着点，一个 116 MB 的装配体会把核心占满二十分钟。所以传一个
 * `isAbandoned` 进来，每两秒问一次，没人要了就立刻收工。
 *
 * @param {Buffer} bytes
 * @param {string} format
 * @param {() => boolean} [isAbandoned]
 * @returns {Promise<{ buffer: Buffer, tris: number, parts: number, ms: number }>}
 */
function convert(bytes, format, isAbandoned) {
  return new Promise((resolve, reject) => {
    let current
    try {
      current = ensureSlot()
    } catch (error) {
      reject(error)
      return
    }
    if (current.job) {
      reject(new Error('converter busy'))
      return
    }
    const timer = setTimeout(() => {
      failSlot(current, new Error('conversion timed out'))
    }, conversionBudget(bytes))
    let watcher = 0
    const stopWatching = () => {
      if (watcher) clearInterval(watcher)
      watcher = 0
    }
    if (typeof isAbandoned === 'function') {
      watcher = setInterval(() => {
        let gone = false
        try {
          gone = isAbandoned() === true
        } catch (error) {
          gone = false
        }
        if (!gone) return
        stopWatching()
        failSlot(current, new Error('cancelled'))
      }, 2000)
      if (typeof watcher.unref === 'function') watcher.unref()
    }
    current.job = {
      resolve: (value) => {
        stopWatching()
        resolve(value)
      },
      reject: (error) => {
        stopWatching()
        reject(error)
      },
      timer
    }

    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    current.worker.postMessage({ bytes: copy.buffer, format, params: PARAMS }, [copy.buffer])
  })
}

/**
 * 这次转换最多等多久。可以传字节数，也可以直接传那段字节（Buffer / Uint8Array）。
 * @param {number|Uint8Array} bytes
 * @returns {number}
 */
export function conversionBudget(bytes) {
  const size = typeof bytes === 'number' ? bytes : (bytes && bytes.length) || 0
  const megabytes = Math.ceil(Math.max(1, size) / (1024 * 1024))
  return Math.max(MIN_TIMEOUT_MS, megabytes * PER_MB_TIMEOUT_MS)
}

/** 磁盘缓存的路径。 */
function diskFile(key) {
  return join(CACHE_DIR, key + '.dsm')
}

/** 读磁盘缓存；没有或坏掉就返回 null。 */
async function readDisk(key) {
  let buffer
  try {
    buffer = await readFile(diskFile(key))
  } catch (error) {
    return null
  }
  if (buffer.length < 16) return null
  const header = new Uint32Array(buffer.buffer, buffer.byteOffset, 4)
  if (header[0] !== 0x4d485344) return null
  return { buffer, tris: header[2], parts: header[3], ms: 0 }
}

/** 写磁盘缓存，失败就算了——缓存只是加速，不是正确性的一部分。 */
async function writeDisk(key, buffer) {
  try {
    await mkdir(CACHE_DIR, { recursive: true })
    const temp = diskFile(key) + '.' + process.pid + '.tmp'
    await writeFile(temp, buffer)
    await rename(temp, diskFile(key))
  } catch (error) {
    return
  }
  pruneDisk().catch(() => {})
}

/** 按条数与总字节数裁掉最旧的缓存文件。 */
async function pruneDisk() {
  let names
  try {
    names = (await readdir(CACHE_DIR)).filter((name) => name.endsWith('.dsm'))
  } catch (error) {
    return
  }
  const stats = []
  for (const name of names) {
    try {
      const info = await stat(join(CACHE_DIR, name))
      stats.push({ name, size: info.size, mtime: info.mtimeMs })
    } catch (error) {
      // 刚好被删了
    }
  }
  let total = stats.reduce((sum, item) => sum + item.size, 0)
  stats.sort((a, b) => a.mtime - b.mtime)
  while (stats.length > DISK_ENTRIES || total > DISK_BYTES) {
    const oldest = stats.shift()
    if (!oldest) break
    total -= oldest.size
    try {
      await unlink(join(CACHE_DIR, oldest.name))
    } catch (error) {
      // 忽略
    }
  }
}

/**
 * 插件入口。
 * @param {import('cordis').Context} ctx
 */
export function apply(ctx) {
  const log = typeof ctx.logger === 'function' ? ctx.logger('dsh-stl-viewer') : console

  /**
   * 注册在这里而不是 apply 顶层：Cordis 要求先声明依赖才能读 ctx.webServer，
   * 而 ctx.inject 只推迟这一段，不会把插件激活整体押后。
   */
  const mount = (hostCtx) => {
    const webServer = hostCtx.webServer
    if (!webServer || typeof webServer.register !== 'function') {
      log.warn('no webServer service here; STEP / IGES / BREP conversion is unavailable')
      return
    }

    /** sha1 → 打包好的网格。 */
    const cache = new Map()
    let cachedBytes = 0

    const remember = (key, value) => {
      if (cache.has(key)) cache.delete(key)
      cache.set(key, value)
      cachedBytes += value.buffer.length
      while (cache.size > CACHE_ENTRIES || cachedBytes > CACHE_BYTES) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cachedBytes -= cache.get(oldest).buffer.length
        cache.delete(oldest)
      }
    }

    /** 一条串行队列：同时打开三个 STEP 时不会一起挤掉内存。 */
    let chain = Promise.resolve()

    const enqueue = (task) => {
      const next = chain.then(task, task)
      chain = next.then(
        () => undefined,
        () => undefined
      )
      return next
    }

    const handler = async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST' })
        response.end()
        return
      }

      let bytes
      try {
        bytes = await readBody(request)
      } catch (error) {
        const tooLarge = error && error.code === 'TOO_LARGE'
        response.writeHead(tooLarge ? 413 : 400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: String((error && error.message) || error) }))
        return
      }

      // 扩展名从查询串取：文件名可能带中文，而 fetch 的 header 只接受
      // ISO-8859-1，放进去会直接抛 "String contains non ISO-8859-1 code point"。
      const query = new URL(String(request.url || '/'), 'http://host').searchParams
      const hint = String(query.get('ext') || request.headers['x-dsh-stl-name'] || '').toLowerCase()
      const ext = hint.includes('.') ? hint.slice(hint.lastIndexOf('.') + 1) : hint
      const format = EXT_FORMAT[ext] || 'step'
      const key = createHash('sha1').update(bytes).digest('hex')
      const socket = request.socket
      const abandoned = () => response.destroyed === true || (socket !== null && socket !== undefined && socket.destroyed === true)

      // 请求已经断了就别开机器：缓存里有的东西顺手给完也行，但没人收，
      // 干脆早退——这也让"关掉面板立刻停手"在排队阶段就成立。
      if (abandoned()) {
        log.info('the panel went away before the conversion started')
        if (!response.destroyed) {
          response.writeHead(499, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: 'cancelled' }))
        }
        return
      }

      try {
        let hit = cache.get(key)
        if (!hit) {
          const stored = await readDisk(key)
          if (stored) {
            hit = stored
            remember(key, stored)
            log.info('served ' + format + ' from disk cache: ' + stored.tris + ' triangles')
          }
        }
        const result = hit
          ? hit
          : await enqueue(async () => {
              const cached = cache.get(key)
              if (cached) return cached
              const started = Date.now()
              const converted = await convert(bytes, format, abandoned)
              log.info(
                'converted ' + format + ' ' + Math.round(bytes.length / 1024) + ' KB → ' +
                  converted.tris + ' triangles in ' + (Date.now() - started) + ' ms'
              )
              remember(key, converted)
              writeDisk(key, converted.buffer).catch(() => {})
              return converted
            })

        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': String(result.buffer.length),
          'cache-control': 'no-store',
          'x-dsh-stl-tris': String(result.tris),
          'x-dsh-stl-parts': String(result.parts)
        })
        response.end(result.buffer)
      } catch (error) {
        const message = String((error && error.message) || error)
        if (message === 'cancelled') {
          log.info('conversion cancelled: the panel went away')
          if (!response.destroyed) {
            response.writeHead(499, { 'content-type': 'application/json' })
            response.end(JSON.stringify({ error: message }))
          }
          return
        }
        log.warn('conversion failed: ' + message)
        if (response.destroyed) return
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: message }))
      }
    }

    hostCtx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: CONVERT_PATH,
        handler
      })
    )

    hostCtx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: HEALTH_PATH,
        handler: (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          response.end(
            JSON.stringify({
              ok: true,
              version: 1,
              formats: Object.keys(EXT_FORMAT),
              maxBytes: MAX_BYTES,
              cached: cache.size,
              cacheDir: CACHE_DIR
            })
          )
        }
      })
    )

    log.info('STEP conversion route ready at ' + CONVERT_PATH)
  }

  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], mount)
  else mount(ctx)
}
