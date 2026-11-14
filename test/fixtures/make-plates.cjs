/*
 * 生成 test/fixtures/plates.stl：上下两块板，中间留 36 mm 空气间隙，
 * 用来演示"点两个平行面，量出面到面距离"。
 *
 *   node test/fixtures/make-plates.cjs
 *
 * 下板 80 × 60 × 6（z 0..6），上板只占左半边 40 × 60 × 6（z 36..42），
 * 所以从右前上方看过去，下板顶面和上板顶面都露在外面，两条面彼此平行。
 */
'use strict'

const fs = require('fs')
const path = require('path')

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

function box(x0, x1, y0, y1, z0, z1) {
  const p = (x, y, z) => [x, y, z]
  quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), [0, 0, 1])
  quad(p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0), p(x0, y0, z0), [0, 0, -1])
  quad(p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1), [0, 1, 0])
  quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), [0, -1, 0])
  quad(p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1), [1, 0, 0])
  quad(p(x0, y0, z0), p(x0, y1, z0), p(x0, y1, z1), p(x0, y0, z1), [-1, 0, 0])
}

box(-40, 40, -30, 30, 0, 6) // 下板
box(-40, 0, -30, 30, 36, 42) // 上板，只压左半边，让下板顶面露出来

const buf = Buffer.alloc(84 + tris.length * 50)
buf.write('dsh-stl-viewer fixture: two plates, 36 mm apart', 0, 'utf8')
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

const out = path.join(__dirname, 'plates.stl')
fs.writeFileSync(out, buf)
console.log('WROTE ' + out + ' ' + buf.length + ' bytes, ' + tris.length + ' facets')
