/**
 * dsh-stl-viewer — STEP / IGES / BREP 转换工作线程。
 *
 * OpenCascade 的 STEP 读取是同步的，一个 6 MB 的钢网模型就要十秒左右；
 * 在主进程里跑会把 DSH 的整个事件循环卡住（会话、工具、Web 路由一起停）。
 * 所以真正干活的 occt-import-js 住在这条 worker 里，主线程只负责收字节、
 * 排队、回包。worker 常驻复用（见 lib/index.js 的 slot），WASM 初始化约 40 ms。
 *
 * 协议（全部走 structured clone）：
 *   in : { bytes: ArrayBuffer, format?: 'step'|'iges'|'brep', params?: object }
 *   out: { ok: true, buffer: ArrayBuffer, tris: number, parts: number, ms: number }
 *      | { ok: false, error: string }
 *
 * buffer 的格式（客户端 decodeMesh 按同一布局解包）：
 *   16 字节头（'DSHM' + 版本 2 + 三角面数 + 零件数）
 *   + 4 字节零件表 JSON 长度 + 该长度的 UTF-8 JSON（含 parts[{name,start,count}]）
 *   + 每个三角面 9 个 float32。
 * 版本 1 是"没有零件表"的旧格式（只有头和顶点），客户端仍然认，用来读旧缓存。
 */
import { parentPort } from 'node:worker_threads'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let occtPromise = null

function loadOcct() {
  if (!occtPromise) occtPromise = require('occt-import-js')()
  return occtPromise
}

const READERS = {
  step: 'ReadStepFile',
  stp: 'ReadStepFile',
  iges: 'ReadIgesFile',
  igs: 'ReadIgesFile',
  brep: 'ReadBrepFile'
}

parentPort.on('message', async (msg) => {
  const started = Date.now()
  try {
    const occt = await loadOcct()
    const key = String(msg.format || 'step').toLowerCase()
    const reader = READERS[key]
    if (!reader) throw new Error('unsupported format: ' + key)

    const bytes = new Uint8Array(msg.bytes)
    const result = occt[reader](bytes, msg.params || null)
    if (!result || result.success === false) {
      throw new Error('OpenCascade could not read this file')
    }

    const meshes = result.meshes || []
    let tris = 0
    for (const mesh of meshes) {
      if (mesh.index && mesh.index.array) tris += Math.floor(mesh.index.array.length / 3)
    }
    if (tris === 0) throw new Error('the file holds no triangles')

    const out = new Float32Array(tris * 9)
    const parts = []
    let at = 0
    for (const mesh of meshes) {
      const pos = mesh.attributes && mesh.attributes.position && mesh.attributes.position.array
      const idx = mesh.index && mesh.index.array
      if (!pos || !idx) continue
      const start = at / 9
      for (let i = 0; i + 2 < idx.length; i += 3) {
        for (let k = 0; k < 3; k += 1) {
          const v = idx[i + k] * 3
          out[at] = pos[v]
          out[at + 1] = pos[v + 1]
          out[at + 2] = pos[v + 2]
          at += 3
        }
      }
      const count = at / 9 - start
      if (count > 0) parts.push({ name: String(mesh.name || ''), start: start, count: count })
    }

    // 零件表用 JSON 传：名字是任意 UTF-8，塞进二进制头里反而难读
    let table = new TextEncoder().encode(JSON.stringify({ parts: parts }))
    if (table.length % 4 !== 0) {
      const padded = new Uint8Array(table.length + (4 - (table.length % 4)))
      padded.set(table)
      table = padded
    }

    const header = new ArrayBuffer(20)
    new Uint32Array(header, 0, 4).set([0x4d485344, 2, tris, parts.length])
    new DataView(header).setUint32(16, table.length, true)

    const packed = new Uint8Array(20 + table.length + out.byteLength)
    packed.set(new Uint8Array(header), 0)
    packed.set(table, 20)
    packed.set(new Uint8Array(out.buffer), 20 + table.length)

    parentPort.postMessage(
      { ok: true, buffer: packed.buffer, tris, parts: parts.length, ms: Date.now() - started },
      [packed.buffer]
    )
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String((err && err.message) || err) })
  }
})
