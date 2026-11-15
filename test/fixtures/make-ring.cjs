/*
 * 生成 test/fixtures/ring.stl：一个垫圈（washer），外径 40、内径 20、厚 6。
 *
 *   node test/fixtures/make-ring.cjs
 *
 * 用它验证"点圆的边界就选中整个圆"：
 * 顶面外圈 R=20、顶面内圈 R=10 各自是一个独立的圆，
 * 点内圈应该读到 Ø 20 / R 10，点外圈应该读到 Ø 40 / R 20。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const SEGMENTS = 48
const R_OUT = 20
const R_IN = 10
const THICK = 6

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const tris = []

/** 四边形 a-b-c-d，winding 统一成"法线朝 out"。 */
function quad(a, b, c, d, out) {
  for (const [p, q, r] of [[a, b, c], [a, c, d]]) {
    const n = cross(sub(q, p), sub(r, p))
    if (dot(n, out) < 0) tris.push([p, r, q])
    else tris.push([p, q, r])
  }
}

/** 第 i 段起点 / 终点在半径 r、高度 z 上的位置。 */
function ring(i, r, z) {
  const a = (2 * Math.PI * i) / SEGMENTS
  return [Math.cos(a) * r, Math.sin(a) * r, z]
}

for (let i = 0; i < SEGMENTS; i++) {
  const j = (i + 1) % SEGMENTS
  const mid = (2 * Math.PI * (i + 0.5)) / SEGMENTS
  const outward = [Math.cos(mid), Math.sin(mid), 0]

  // 顶面环带（法线 +Z）：内圈 → 外圈
  quad(ring(i, R_IN, THICK), ring(j, R_IN, THICK), ring(j, R_OUT, THICK), ring(i, R_OUT, THICK), [0, 0, 1])
  // 底面环带（法线 -Z）
  quad(ring(i, R_OUT, 0), ring(j, R_OUT, 0), ring(j, R_IN, 0), ring(i, R_IN, 0), [0, 0, -1])
  // 外壁（法线朝外）
  quad(ring(i, R_OUT, 0), ring(j, R_OUT, 0), ring(j, R_OUT, THICK), ring(i, R_OUT, THICK), outward)
  // 内壁（法线朝轴心）
  quad(ring(j, R_IN, 0), ring(i, R_IN, 0), ring(i, R_IN, THICK), ring(j, R_IN, THICK), [
    -outward[0],
    -outward[1],
    0
  ])
}

const buf = Buffer.alloc(84 + tris.length * 50)
buf.write('dsh-stl-viewer fixture: washer 40/20 x 6', 0, 'utf8')
buf.writeUInt32LE(tris.length, 80)
tris.forEach((tri, i) => {
  const o = 84 + i * 50
  // 法线留 0：解析器会按 winding 重算，正好顺带验证这条路径
  tri.forEach((v, k) => {
    buf.writeFloatLE(v[0], o + 12 + k * 12)
    buf.writeFloatLE(v[1], o + 16 + k * 12)
    buf.writeFloatLE(v[2], o + 20 + k * 12)
  })
})

const out = path.join(__dirname, 'ring.stl')
fs.writeFileSync(out, buf)
console.log('WROTE ' + out + ' ' + buf.length + ' bytes, ' + tris.length + ' facets')
