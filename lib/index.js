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

export const name = 'dsh-stl-viewer'

const CONVERT_PATH = '/dsh-stl-viewer/convert'
const HEALTH_PATH = '/dsh-stl-viewer/step'

/** 一次转换能接受的字节数。97 MB 的装配文件仍可打开，但会很慢。 */
const MAX_BYTES = 128 * 1024 * 1024
/** 内存缓存：最多几条、总共多少字节。 */
const CACHE_ENTRIES = 8
const CACHE_BYTES = 192 * 1024 * 1024
/** 单次转换的超时。97 MB 的文件可能需要几分钟，这里给足。 */
const TIMEOUT_MS = 10 * 60 * 1000

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

/**
 * 在一条一次性 worker 里跑一次转换。
 * @param {Buffer} bytes
 * @param {string} format
 * @returns {Promise<{ buffer: Buffer, tris: number, parts: number, ms: number }>}
 */
function convert(bytes, format) {
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(new URL('./convert.worker.mjs', import.meta.url))
    } catch (error) {
      reject(error)
      return
    }

    const finish = (fn, value) => {
      clearTimeout(timer)
      worker.terminate().catch(() => {})
      fn(value)
    }

    const timer = setTimeout(() => {
      finish(reject, new Error('conversion timed out'))
    }, TIMEOUT_MS)

    worker.once('message', (msg) => {
      if (msg && msg.ok) {
        finish(resolve, {
          buffer: Buffer.from(msg.buffer),
          tris: msg.tris,
          parts: msg.parts,
          ms: msg.ms
        })
        return
      }
      finish(reject, new Error((msg && msg.error) || 'conversion failed'))
    })
    worker.once('error', (error) => finish(reject, error))
    worker.once('exit', (code) => {
      if (code !== 0) finish(reject, new Error('converter exited with code ' + code))
    })

    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    worker.postMessage({ bytes: copy.buffer, format, params: PARAMS }, [copy.buffer])
  })
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

      try {
        const hit = cache.get(key)
        const result = hit
          ? hit
          : await enqueue(async () => {
              const cached = cache.get(key)
              if (cached) return cached
              const started = Date.now()
              const converted = await convert(bytes, format)
              log.info(
                'converted ' + format + ' ' + Math.round(bytes.length / 1024) + ' KB → ' +
                  converted.tris + ' triangles in ' + (Date.now() - started) + ' ms'
              )
              remember(key, converted)
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
        log.warn('conversion failed: ' + message)
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
              cached: cache.size
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
