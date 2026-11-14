/*!
 * dsh-stl-viewer — 客户端半侧（浏览器）。
 *
 * 给 dsh-better-sidebar 注册一个 `stl` 文件查看器：fetch 该文件的原始字节
 * （fetchStrategy: 'mediaUrl' 由宿主直接给出 mediaUrl），解析二进制 / ASCII
 * STL，然后用 WebGL 画出来，轨道相机交互与常规 3D 看图一致：
 *
 *   左键拖动  = 旋转（orbit）
 *   滚轮      = 缩放（保持目标点不动）
 *   右键拖动  = 平移（Shift + 左键 等价）
 *   双击      = 复位视角
 *
 * 约束：本文件是 classic script（不能有 import / export），由 DSH 模块加载器
 * 通过 window.__ModuleLoader__.load 执行，factory 的 require 只解析宿主已注册
 * 的模块（react 等）。没有任何构建步骤 —— 文件即产物。
 */
window.__ModuleLoader__.load({
  id: 'dsh-stl-viewer',
  factory: function (require) {
    'use strict'

    var React = require('react')
    var h = React.createElement
    var useEffect = React.useEffect
    var useRef = React.useRef
    var useState = React.useState

    // ==================================================================
    // 文案
    // ==================================================================

    var ZH = {
      title: 'STL 三维预览',
      reading: '正在解析 STL…',
      parseFailed: '无法解析这个 STL 文件（既不是二进制也不是 ASCII）。',
      loadFailed: '读取 STL 失败',
      webglFailed: '当前环境不支持 WebGL，无法渲染三维模型。',
      empty: '这个 STL 里没有三角面。',
      triangles: '三角面',
      size: '尺寸',
      reset: '复位视角',
      retry: '重试',
      hint: '左键拖动旋转 · 滚轮缩放 · 右键拖动平移 · 双击复位',
      measure: '测量',
      measureHint: '点两个点量距离 · 拖动仍可旋转 · Esc 退出',
      unit: 'mm'
    }

    var EN = {
      title: 'STL 3D preview',
      reading: 'Parsing STL…',
      parseFailed: 'This STL file could not be parsed (neither binary nor ASCII).',
      loadFailed: 'Failed to read the STL file',
      webglFailed: 'WebGL is unavailable, so the model cannot be rendered.',
      empty: 'This STL contains no triangles.',
      triangles: 'triangles',
      size: 'size',
      reset: 'Reset view',
      retry: 'Retry',
      hint: 'Drag to orbit · wheel to zoom · right-drag to pan · double-click to reset',
      measure: 'Measure',
      measureHint: 'Click two points to measure · drag still orbits · Esc to exit',
      unit: 'mm'
    }

    var LANG = 'zh'
    try {
      var tag = String(
        (document.documentElement && document.documentElement.getAttribute('lang')) ||
        navigator.language || ''
      ).toLowerCase()
      if (tag && tag.indexOf('zh') !== 0) LANG = 'en'
    } catch (e) { /* 保守：默认中文 */ }

    function t(key) {
      var table = LANG === 'en' ? EN : ZH
      return table[key] || ZH[key] || key
    }

    // ==================================================================
    // 小工具
    // ==================================================================

    function clamp(v, lo, hi) {
      return v < lo ? lo : (v > hi ? hi : v)
    }

    function thousands(n) {
      return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    /** 模型尺寸没有单位可言（STL 只存数字），这里只按量级选小数位。 */
    function fmtDim(v) {
      if (!isFinite(v)) return '–'
      if (Math.abs(v) >= 1000) return String(Math.round(v))
      if (Math.abs(v) >= 10) return v.toFixed(1)
      if (Math.abs(v) >= 0.1) return v.toFixed(2)
      return v.toPrecision(2)
    }

    /** 浅合并两份样式，用来给"测量"按钮加高亮。 */
    function merge(base, extra) {
      var out = {}
      var key
      for (key in base) {
        if (Object.prototype.hasOwnProperty.call(base, key)) out[key] = base[key]
      }
      for (key in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) out[key] = extra[key]
      }
      return out
    }

    // ==================================================================
    // STL 解析
    //
    // binary: 80 字节头 + uint32 三角面数 + 每面 50 字节（法线 12 + 3 顶点 36 + 属性 2）
    // ascii : "solid ... facet normal ... vertex x y z" × 3 × N
    // ==================================================================

    /**
     * 把三角面顶点规范化：平移到包围盒中心、等比缩放到最大边长 = 2，
     * 同时逐面算法线（STL 里存的法线常常是 0 或是错的，重算更可靠）。
     */
    function finalizeMesh(positions, count) {
      var min = [Infinity, Infinity, Infinity]
      var max = [-Infinity, -Infinity, -Infinity]
      var total = count * 9
      var i

      for (i = 0; i < total; i += 3) {
        var x = positions[i]
        var y = positions[i + 1]
        var z = positions[i + 2]
        if (x < min[0]) min[0] = x
        if (x > max[0]) max[0] = x
        if (y < min[1]) min[1] = y
        if (y > max[1]) max[1] = y
        if (z < min[2]) min[2] = z
        if (z > max[2]) max[2] = z
      }

      var dims = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
      var center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
      var maxDim = Math.max(dims[0], dims[1], dims[2])
      var scale = maxDim > 1e-9 ? 2 / maxDim : 1

      var normals = new Float32Array(total)

      for (var tri = 0; tri < count; tri++) {
        var o = tri * 9

        // 居中 + 缩放 + Z-up → Y-up（STL 源自 CAD / 3D 打印，约定 Z 轴朝上；
        // 渲染用 Y 轴朝上，所以 (x,y,z) → (x, z, -y)，模型才是"站着"的）
        for (i = 0; i < 9; i += 3) {
          var px = (positions[o + i] - center[0]) * scale
          var py = (positions[o + i + 1] - center[1]) * scale
          var pz = (positions[o + i + 2] - center[2]) * scale
          positions[o + i] = px
          positions[o + i + 1] = pz
          positions[o + i + 2] = -py
        }

        var ax = positions[o], ay = positions[o + 1], az = positions[o + 2]
        var bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5]
        var cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8]

        var ux = bx - ax, uy = by - ay, uz = bz - az
        var vx = cx - ax, vy = cy - ay, vz = cz - az
        var nx = uy * vz - uz * vy
        var ny = uz * vx - ux * vz
        var nz = ux * vy - uy * vx
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz)
        if (len > 1e-12) {
          nx /= len
          ny /= len
          nz /= len
        } else {
          nx = 0
          ny = 0
          nz = 1
        }
        // 法线跟着顶点做同一套 Z-up → Y-up 旋转
        var rnx = nx
        var rny = nz
        var rnz = -ny
        nx = rnx
        ny = rny
        nz = rnz

        normals[o] = nx
        normals[o + 1] = ny
        normals[o + 2] = nz
        normals[o + 3] = nx
        normals[o + 4] = ny
        normals[o + 5] = nz
        normals[o + 6] = nx
        normals[o + 7] = ny
        normals[o + 8] = nz
      }

      var hx = (dims[0] * scale) / 2
      var hy = (dims[1] * scale) / 2
      var hz = (dims[2] * scale) / 2

      return {
        positions: positions,
        normals: normals,
        triangleCount: count,
        dims: dims,
        radius: Math.sqrt(hx * hx + hy * hy + hz * hz) || 1,
        // 反算回模型原始坐标用：model = n / scale + center（x 轴正向，
        // 而屏幕里的 y 轴来自原始 z 轴，屏幕里的 z 轴来自原始 -y 轴）
        center: center,
        scale: scale
      }
    }

    function parseBinary(bytes, count, byteLength) {
      var dv = new DataView(bytes.buffer, bytes.byteOffset, byteLength)
      var positions = new Float32Array(count * 9)
      var o = 84
      var p = 0
      for (var tri = 0; tri < count; tri++) {
        o += 12 // 跳过面法线，后面自己算
        for (var v = 0; v < 3; v++) {
          positions[p++] = dv.getFloat32(o, true)
          positions[p++] = dv.getFloat32(o + 4, true)
          positions[p++] = dv.getFloat32(o + 8, true)
          o += 12
        }
        o += 2 // attribute byte count
      }
      return finalizeMesh(positions, count)
    }

    var VERTEX_RE = /vertex\s+(-?[\d.]+(?:[eE][-+]?\d+)?)\s+(-?[\d.]+(?:[eE][-+]?\d+)?)\s+(-?[\d.]+(?:[eE][-+]?\d+)?)/g

    function parseAscii(text) {
      VERTEX_RE.lastIndex = 0
      var values = []
      var m
      while ((m = VERTEX_RE.exec(text)) !== null) {
        values.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]))
        if (values.length > 6000000) break // ≈ 200 万顶点上限，防内存爆掉
      }
      var count = Math.floor(values.length / 9)
      if (count < 1) throw new Error('no triangles')
      var positions = new Float32Array(count * 9)
      for (var i = 0; i < count * 9; i++) positions[i] = values[i]
      return finalizeMesh(positions, count)
    }

    function decodeText(bytes) {
      try {
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      } catch (e) {
        return ''
      }
    }

    function parseStl(bytes) {
      var n = bytes.byteLength
      if (n === 0) throw new Error(t('empty'))
      if (n < 15) throw new Error(t('parseFailed'))

      // 1) 标准二进制：84 + 50 × N 恰好等于文件长度
      if (n >= 84) {
        var dv = new DataView(bytes.buffer, bytes.byteOffset, n)
        var exact = dv.getUint32(80, true)
        if (exact > 0 && 84 + exact * 50 === n) return parseBinary(bytes, exact, n)
      }

      // 2) ASCII
      var head = decodeText(bytes.subarray(0, Math.min(n, 1024)))
      if (/vertex/i.test(head) || /facet/i.test(head) || /^\s*solid/i.test(head)) {
        var text = decodeText(bytes)
        if (/vertex/i.test(text)) {
          try {
            return parseAscii(text)
          } catch (e2) { /* 交给二进制兜底 */ }
        }
      }

      // 3) 二进制但尾部有多余字节（有些导出器会补 0 或追加元数据）
      if (n >= 84) {
        var dv2 = new DataView(bytes.buffer, bytes.byteOffset, n)
        var loose = dv2.getUint32(80, true)
        if (loose > 0 && 84 + loose * 50 <= n) return parseBinary(bytes, loose, n)
      }

      throw new Error(t('parseFailed'))
    }

    // ==================================================================
    // 4×4 矩阵（列主序，与 WebGL 一致）
    // ==================================================================

    function mat4() {
      return new Float32Array(16)
    }

    function perspective(out, fovy, aspect, near, far) {
      var f = 1 / Math.tan(fovy / 2)
      var nf = 1 / (near - far)
      out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0
      out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0
      out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1
      out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0
      return out
    }

    function lookAt(out, eye, center, up) {
      var zx = eye[0] - center[0]
      var zy = eye[1] - center[1]
      var zz = eye[2] - center[2]
      var zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1
      zx /= zl; zy /= zl; zz /= zl

      var xx = up[1] * zz - up[2] * zy
      var xy = up[2] * zx - up[0] * zz
      var xz = up[0] * zy - up[1] * zx
      var xl = Math.sqrt(xx * xx + xy * xy + xz * xz)
      if (xl < 1e-6) {
        xx = 1; xy = 0; xz = 0
      } else {
        xx /= xl; xy /= xl; xz /= xl
      }

      var yx = zy * xz - zz * xy
      var yy = zz * xx - zx * xz
      var yz = zx * xy - zy * xx

      out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0
      out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0
      out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0
      out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2])
      out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2])
      out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2])
      out[15] = 1
      return out
    }

    /** out = a × b（out 不能与 a / b 同一个数组）。 */
    function multiply(out, a, b) {
      for (var c = 0; c < 4; c++) {
        var b0 = b[c * 4]
        var b1 = b[c * 4 + 1]
        var b2 = b[c * 4 + 2]
        var b3 = b[c * 4 + 3]
        out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3
        out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3
        out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3
        out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3
      }
      return out
    }

    // ==================================================================
    // 着色器
    // ==================================================================

    var VERTEX_SRC = [
      'attribute vec3 aPos;',
      'attribute vec3 aNrm;',
      'uniform mat4 uViewProj;',
      'varying vec3 vNrm;',
      'void main() {',
      '  vNrm = aNrm;',
      '  gl_Position = uViewProj * vec4(aPos, 1.0);',
      '}'
    ].join('\n')

    var FRAGMENT_SRC = [
      '#ifdef GL_FRAGMENT_PRECISION_HIGH',
      'precision highp float;',
      '#else',
      'precision mediump float;',
      '#endif',
      'varying vec3 vNrm;',
      'uniform vec3 uBase;',
      'void main() {',
      '  vec3 n = normalize(vNrm);',
      '  if (!gl_FrontFacing) n = -n;', // 双面显示：背面也按朝向打光
      '  vec3 key = normalize(vec3(0.42, 0.78, 0.62));',
      '  vec3 fill = normalize(vec3(-0.72, -0.10, 0.36));',
      '  float dk = max(dot(n, key), 0.0);',
      '  float df = max(dot(n, fill), 0.0);',
      '  float sky = 0.5 + 0.5 * n.y;',
      '  vec3 col = uBase * (0.24 + 0.68 * dk + 0.16 * df + 0.10 * sky);',
      '  float spec = pow(max(dot(n, normalize(key + vec3(0.0, 0.0, 1.0))), 0.0), 44.0);',
      '  col += vec3(0.20 * spec);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n')

    // 量距离用的叠加层：两点之间的线段 + 两个端点（点精灵画成圆点）
    var OVERLAY_VERTEX_SRC = [
      'attribute vec3 aPos;',
      'uniform mat4 uViewProj;',
      'uniform float uSize;',
      'void main() {',
      '  gl_Position = uViewProj * vec4(aPos, 1.0);',
      '  gl_PointSize = uSize;',
      '}'
    ].join('\n')

    var OVERLAY_FRAGMENT_SRC = [
      '#ifdef GL_FRAGMENT_PRECISION_HIGH',
      'precision highp float;',
      '#else',
      'precision mediump float;',
      '#endif',
      'uniform vec4 uColor;',
      'uniform float uRound;',
      'void main() {',
      '  if (uRound > 0.5) {',
      '    vec2 d = gl_PointCoord - vec2(0.5);',
      '    if (dot(d, d) > 0.25) discard;',
      '  }',
      '  gl_FragColor = uColor;',
      '}'
    ].join('\n')

    var ACCENT = [1.0, 0.68, 0.30, 1.0]

    // ==================================================================
    // 射线求交（量距离时把屏幕上的点击落成模型表面上的点）
    // ==================================================================

    /**
     * Möller–Trumbore，返回命中距离（沿射线行进的距离），没命中返回 -1。
     * 不做背面剔除：STL 常有反向面，两面都要能点到。
     */
    function rayTriangle(ox, oy, oz, dx, dy, dz, pos, o) {
      var ax = pos[o], ay = pos[o + 1], az = pos[o + 2]
      var e1x = pos[o + 3] - ax, e1y = pos[o + 4] - ay, e1z = pos[o + 5] - az
      var e2x = pos[o + 6] - ax, e2y = pos[o + 7] - ay, e2z = pos[o + 8] - az

      var px = dy * e2z - dz * e2y
      var py = dz * e2x - dx * e2z
      var pz = dx * e2y - dy * e2x

      var det = e1x * px + e1y * py + e1z * pz
      if (det > -1e-12 && det < 1e-12) return -1
      var inv = 1 / det

      var tx = ox - ax, ty = oy - ay, tz = oz - az
      var u = (tx * px + ty * py + tz * pz) * inv
      if (u < -1e-6 || u > 1 + 1e-6) return -1

      var qx = ty * e1z - tz * e1y
      var qy = tz * e1x - tx * e1z
      var qz = tx * e1y - ty * e1x

      var v = (dx * qx + dy * qy + dz * qz) * inv
      if (v < -1e-6 || u + v > 1 + 1e-6) return -1

      var hit = (e2x * qx + e2y * qy + e2z * qz) * inv
      return hit > 1e-6 ? hit : -1
    }

    /**
     * 屏幕坐标 → 世界射线（原点 + 单位方向）。视图矩阵由相机参数直接给出，
     * 和 drawFrame 里的 lookAt 用的是同一套基，所以两者严格一致。
     */
    function screenRay(cam, fov, cssWidth, cssHeight, clientX, clientY, rect) {
      var cp = Math.cos(cam.pitch)
      var sp = Math.sin(cam.pitch)
      var dir = [cp * Math.sin(cam.yaw), sp, cp * Math.cos(cam.yaw)]
      var eye = [
        cam.target[0] + dir[0] * cam.dist,
        cam.target[1] + dir[1] * cam.dist,
        cam.target[2] + dir[2] * cam.dist
      ]
      var fx = -dir[0], fy = -dir[1], fz = -dir[2]

      // right = normalize(cross(fwd, [0,1,0]))
      var rx = -fz, ry = 0, rz = fx
      var rl = Math.sqrt(rx * rx + rz * rz) || 1
      rx /= rl; rz /= rl

      // up = cross(right, fwd)
      var ux = ry * fz - rz * fy
      var uy = rz * fx - rx * fz
      var uz = rx * fy - ry * fx

      var half = Math.tan(fov / 2)
      var aspect = cssWidth / Math.max(1, cssHeight)
      var ndcX = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
      var ndcY = 1 - ((clientY - rect.top) / Math.max(1, rect.height)) * 2

      var sx = ndcX * half * aspect
      var sy = ndcY * half

      var dx = fx + rx * sx + ux * sy
      var dy = fy + ry * sx + uy * sy
      var dz = fz + rz * sx + uz * sy
      var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1

      return { origin: eye, dir: [dx / dl, dy / dl, dz / dl] }
    }

    // ==================================================================
    // 渲染器（命令式；React 只负责挂载 / 卸载 / 喂数据）
    // ==================================================================

    var BASE_COLOR = [0.56, 0.65, 0.80]
    var FOV = (40 * Math.PI) / 180

    function createViewer(canvas) {
      var gl = null
      var program = null
      var attribPos = -1
      var attribNrm = -1
      var uniformVP = null
      var uniformBase = null
      var posBuffer = null
      var nrmBuffer = null
      var vertexCount = 0
      var mesh = null

      // 测量叠加层
      var overlayProgram = null
      var overlayPos = -1
      var overlayVP = null
      var overlayColor = null
      var overlayRound = null
      var overlaySize = null
      var overlayBuffer = null

      var measureMode = false
      var picks = [] // 已落定的点，渲染坐标（模型归一化之后的空间）
      var hover = null // 只放下一个点时的橡皮筋端点
      var labelEls = null // { box, dist, delta }
      var measureListener = null // 测量状态变化时通知 React

      var cssWidth = 1
      var cssHeight = 1
      var pixelRatio = 1

      var rafId = 0
      var attached = false
      var drawQueued = false

      var cam = {
        yaw: 0.85,
        pitch: 0.42,
        dist: 4,
        fit: 4,
        min: 0.05,
        max: 60,
        target: [0, 0, 0]
      }

      var projMatrix = mat4()
      var viewMatrix = mat4()
      var vpMatrix = mat4()

      var drag = null

      // ---------------- GL 初始化 ----------------

      function compile(type, source) {
        var shader = gl.createShader(type)
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          var log = gl.getShaderInfoLog(shader)
          gl.deleteShader(shader)
          throw new Error('[dsh-stl-viewer] shader: ' + log)
        }
        return shader
      }

      function ensureGl() {
        if (gl) return true
        try {
          var opts = {
            alpha: true,
            antialias: true,
            depth: true,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance'
          }
          gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts)
        } catch (e) {
          gl = null
        }
        if (!gl) return false

        try {
          var vs = compile(gl.VERTEX_SHADER, VERTEX_SRC)
          var fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC)
          program = gl.createProgram()
          gl.attachShader(program, vs)
          gl.attachShader(program, fs)
          gl.linkProgram(program)
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error('[dsh-stl-viewer] link: ' + gl.getProgramInfoLog(program))
          }
          gl.deleteShader(vs)
          gl.deleteShader(fs)
        } catch (e2) {
          program = null
          try { gl.getExtension('WEBGL_lose_context').loseContext() } catch (e3) {}
          gl = null
          return false
        }

        attribPos = gl.getAttribLocation(program, 'aPos')
        attribNrm = gl.getAttribLocation(program, 'aNrm')
        uniformVP = gl.getUniformLocation(program, 'uViewProj')
        uniformBase = gl.getUniformLocation(program, 'uBase')
        posBuffer = gl.createBuffer()
        nrmBuffer = gl.createBuffer()

        // 测量叠加层单独一套程序；它失败不该拖垮主渲染，所以单独兜底
        try {
          var ovs = compile(gl.VERTEX_SHADER, OVERLAY_VERTEX_SRC)
          var ofs = compile(gl.FRAGMENT_SHADER, OVERLAY_FRAGMENT_SRC)
          overlayProgram = gl.createProgram()
          gl.attachShader(overlayProgram, ovs)
          gl.attachShader(overlayProgram, ofs)
          gl.linkProgram(overlayProgram)
          if (!gl.getProgramParameter(overlayProgram, gl.LINK_STATUS)) {
            throw new Error('[dsh-stl-viewer] overlay link: ' + gl.getProgramInfoLog(overlayProgram))
          }
          gl.deleteShader(ovs)
          gl.deleteShader(ofs)
          overlayPos = gl.getAttribLocation(overlayProgram, 'aPos')
          overlayVP = gl.getUniformLocation(overlayProgram, 'uViewProj')
          overlayColor = gl.getUniformLocation(overlayProgram, 'uColor')
          overlayRound = gl.getUniformLocation(overlayProgram, 'uRound')
          overlaySize = gl.getUniformLocation(overlayProgram, 'uSize')
          overlayBuffer = gl.createBuffer()
        } catch (eOv) {
          overlayProgram = null
        }

        gl.disable(gl.CULL_FACE)
        gl.enable(gl.DEPTH_TEST)
        gl.depthFunc(gl.LEQUAL)
        gl.disable(gl.BLEND)

        if (mesh) uploadMesh()
        return true
      }

      // ---------------- 数据 ----------------

      function uploadMesh() {
        if (!gl || !mesh) return
        vertexCount = mesh.positions.length / 3
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW)
        gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW)
        resetCamera()
      }

      function setMesh(next) {
        mesh = next
        picks = []
        hover = null
        if (!gl) return
        uploadMesh()
        updateLabel()
        invalidate()
      }

      // ---------------- 测量 ----------------

      function notifyMeasure() {
        if (typeof measureListener !== 'function') return
        try { measureListener(measureMode, picks.length) } catch (e) {}
      }

      /** 渲染坐标 → 模型原始坐标（量出来的数值才是图纸上的单位）。 */
      function toModel(p) {
        var s = (mesh && mesh.scale) || 1
        var c = (mesh && mesh.center) || [0, 0, 0]
        return [p[0] / s + c[0], -p[2] / s + c[1], p[1] / s + c[2]]
      }

      /** 屏幕上的一点落在模型表面的最近命中点（渲染坐标）。 */
      function pickAt(clientX, clientY) {
        if (!mesh || !vertexCount) return null
        var rect = canvas.getBoundingClientRect()
        var ray = screenRay(cam, FOV, cssWidth, cssHeight, clientX, clientY, rect)
        var pos = mesh.positions
        var best = -1
        for (var o = 0; o < pos.length; o += 9) {
          var hit = rayTriangle(
            ray.origin[0], ray.origin[1], ray.origin[2],
            ray.dir[0], ray.dir[1], ray.dir[2],
            pos, o
          )
          if (hit > 0 && (best < 0 || hit < best)) best = hit
        }
        if (best < 0) return null
        return [
          ray.origin[0] + ray.dir[0] * best,
          ray.origin[1] + ray.dir[1] * best,
          ray.origin[2] + ray.dir[2] * best
        ]
      }

      /**
       * 只落下一个点时画"橡皮筋"：取光标射线上与第一个点同样远的那个位置，
       * 不做三角形求交 —— 拖动时每帧都算，便宜得多，视觉上也够。
       */
      function hoverAt(clientX, clientY) {
        if (!mesh || picks.length !== 1) {
          hover = null
          return
        }
        var rect = canvas.getBoundingClientRect()
        var ray = screenRay(cam, FOV, cssWidth, cssHeight, clientX, clientY, rect)
        var p0 = picks[0]
        var dx = p0[0] - ray.origin[0]
        var dy = p0[1] - ray.origin[1]
        var dz = p0[2] - ray.origin[2]
        var along = dx * ray.dir[0] + dy * ray.dir[1] + dz * ray.dir[2]
        if (!(along > 0)) along = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
        hover = [
          ray.origin[0] + ray.dir[0] * along,
          ray.origin[1] + ray.dir[1] * along,
          ray.origin[2] + ray.dir[2] * along
        ]
      }

      function project(p) {
        var m = vpMatrix
        var cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]
        var cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]
        var cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
        if (cw <= 1e-6) return null
        return {
          x: (cx / cw * 0.5 + 0.5) * cssWidth,
          y: (0.5 - cy / cw * 0.5) * cssHeight
        }
      }

      /** 数值标签是普通 DOM，跟着相机走（每帧只改 left/top/textContent，不惊动 React）。 */
      function updateLabel() {
        if (!labelEls || !labelEls.box) return
        var box = labelEls.box
        if (picks.length < 2) {
          box.style.display = 'none'
          return
        }
        var a = toModel(picks[0])
        var b = toModel(picks[1])
        var dx = b[0] - a[0]
        var dy = b[1] - a[1]
        var dz = b[2] - a[2]
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

        // 标签放在线段中点的"上方一侧"，而不是正中：否则它会压住两个端点
        var sa = project(picks[0])
        var sb = project(picks[1])
        if (!sa || !sb) {
          box.style.display = 'none'
          return
        }
        var mx = (sa.x + sb.x) / 2
        var my = (sa.y + sb.y) / 2
        var sx = sb.x - sa.x
        var sy = sb.y - sa.y
        var slen = Math.sqrt(sx * sx + sy * sy)
        var ox = 0
        var oy = -22
        if (slen > 1) {
          // 屏幕空间的法线，统一朝上（y 为负）；偏移要比标签自身略大，
          // 否则线段短的时候标签会把起点盖住
          var nx = -sy / slen
          var ny = sx / slen
          if (ny > 0) { nx = -nx; ny = -ny }
          ox = nx * 26
          oy = ny * 26 - 6
        }

        box.style.display = 'block'
        box.style.left = (mx + ox) + 'px'
        box.style.top = (my + oy) + 'px'
        if (labelEls.dist) labelEls.dist.textContent = fmtDim(dist) + ' ' + t('unit')
        if (labelEls.delta) {
          labelEls.delta.textContent =
            'ΔX ' + fmtDim(Math.abs(dx)) +
            '  ΔY ' + fmtDim(Math.abs(dy)) +
            '  ΔZ ' + fmtDim(Math.abs(dz))
        }
      }

      function addPick(clientX, clientY) {
        var p = pickAt(clientX, clientY)
        if (!p) return
        if (picks.length >= 2) picks = []
        picks.push(p)
        hover = null
        if (picks.length === 1) hoverAt(clientX, clientY)
        updateLabel()
        invalidate()
        notifyMeasure()
      }

      function setMeasureMode(on) {
        var next = !!on
        if (next === measureMode) return
        measureMode = next
        picks = []
        hover = null
        canvas.style.cursor = measureMode ? 'crosshair' : 'grab'
        updateLabel()
        invalidate()
        notifyMeasure()
      }

      function clearMeasure() {
        picks = []
        hover = null
        updateLabel()
        invalidate()
        notifyMeasure()
      }

      function setLabelEls(box, dist, delta) {
        labelEls = box ? { box: box, dist: dist || null, delta: delta || null } : null
        updateLabel()
      }

      function onMeasureChange(fn) {
        measureListener = typeof fn === 'function' ? fn : null
      }

      // ---------------- 相机 ----------------

      function resetCamera() {
        var radius = mesh ? mesh.radius : 1.5
        cam.target = [0, 0, 0]
        cam.yaw = 0.85
        cam.pitch = 0.42
        cam.fit = (radius / Math.sin(FOV / 2)) * 1.12
        cam.dist = cam.fit
        cam.min = Math.max(0.02, radius * 0.15)
        cam.max = Math.max(4, radius * 30)
        invalidate()
      }

      function eyeToTarget() {
        var cp = Math.cos(cam.pitch)
        var sp = Math.sin(cam.pitch)
        // 从目标点指向相机的方向
        return [cp * Math.sin(cam.yaw), sp, cp * Math.cos(cam.yaw)]
      }

      function orbit(dx, dy) {
        cam.yaw -= dx * 0.008
        cam.pitch = clamp(cam.pitch + dy * 0.008, -1.45, 1.45)
        invalidate()
      }

      function pan(dx, dy) {
        var dir = eyeToTarget()
        var fwd = [-dir[0], -dir[1], -dir[2]]
        // right = normalize(cross(fwd, up[0,1,0]))；fwd 永不为竖直（pitch 已夹住）
        var rx = -fwd[2]
        var ry = 0
        var rz = fwd[0]
        var rl = Math.sqrt(rx * rx + rz * rz) || 1
        rx /= rl; rz /= rl
        // camUp = cross(right, fwd)
        var ux2 = ry * fwd[2] - rz * fwd[1]
        var uy2 = rz * fwd[0] - rx * fwd[2]
        var uz2 = rx * fwd[1] - ry * fwd[0]

        var worldPerPixel = (2 * cam.dist * Math.tan(FOV / 2)) / Math.max(1, cssHeight)
        var mx = dx * worldPerPixel
        var my = dy * worldPerPixel
        cam.target[0] += -rx * mx + ux2 * my
        cam.target[1] += -ry * mx + uy2 * my
        cam.target[2] += -rz * mx + uz2 * my
        invalidate()
      }

      function zoom(deltaY) {
        var step = clamp(deltaY, -240, 240)
        cam.dist = clamp(cam.dist * Math.exp(step * 0.0016), cam.min, cam.max)
        invalidate()
      }

      // ---------------- 尺寸 / 绘制 ----------------

      function resize() {
        var rect = canvas.getBoundingClientRect()
        var w = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1))
        var h = Math.max(1, Math.round(rect.height || canvas.clientHeight || 1))
        var dpr = Math.min(window.devicePixelRatio || 1, 2)
        if (w === cssWidth && h === cssHeight && dpr === pixelRatio) return
        cssWidth = w
        cssHeight = h
        pixelRatio = dpr
        canvas.width = Math.max(1, Math.round(w * dpr))
        canvas.height = Math.max(1, Math.round(h * dpr))
        invalidate()
      }

      /** 测量线段 + 端点，关深度测试画在最上层（和模型表面同深度也不打架）。 */
      function drawOverlay() {
        if (!gl || !overlayProgram) return

        var line = []
        if (picks.length === 1 && hover) {
          line.push(
            picks[0][0], picks[0][1], picks[0][2],
            hover[0], hover[1], hover[2]
          )
        } else if (picks.length >= 2) {
          line.push(
            picks[0][0], picks[0][1], picks[0][2],
            picks[1][0], picks[1][1], picks[1][2]
          )
        }

        gl.useProgram(overlayProgram)
        gl.uniformMatrix4fv(overlayVP, false, vpMatrix)
        gl.bindBuffer(gl.ARRAY_BUFFER, overlayBuffer)
        gl.enableVertexAttribArray(overlayPos)
        gl.vertexAttribPointer(overlayPos, 3, gl.FLOAT, false, 0, 0)
        gl.disable(gl.DEPTH_TEST)

        if (line.length) {
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(line), gl.DYNAMIC_DRAW)
          gl.uniform4f(overlayColor, ACCENT[0], ACCENT[1], ACCENT[2], ACCENT[3])
          gl.uniform1f(overlayRound, 0)
          gl.uniform1f(overlaySize, 1)
          gl.drawArrays(gl.LINES, 0, line.length / 3)
        }

        var dots = []
        for (var i = 0; i < picks.length && i < 2; i++) {
          dots.push(picks[i][0], picks[i][1], picks[i][2])
        }
        if (dots.length) {
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(dots), gl.DYNAMIC_DRAW)
          var dot = Math.max(8, Math.round(10 * pixelRatio))
          gl.uniform1f(overlayRound, 1)
          // 先画一圈深色描边，再叠橙色实心点，压在浅色模型上才看得清
          gl.uniform4f(overlayColor, 0.06, 0.06, 0.08, 0.9)
          gl.uniform1f(overlaySize, dot + Math.max(2, Math.round(2 * pixelRatio)))
          gl.drawArrays(gl.POINTS, 0, dots.length / 3)
          gl.uniform4f(overlayColor, ACCENT[0], ACCENT[1], ACCENT[2], ACCENT[3])
          gl.uniform1f(overlaySize, dot)
          gl.drawArrays(gl.POINTS, 0, dots.length / 3)
        }

        gl.enable(gl.DEPTH_TEST)
      }

      function drawFrame() {
        rafId = 0
        drawQueued = false
        if (!gl || !program || !vertexCount) {
          if (gl) {
            gl.viewport(0, 0, canvas.width, canvas.height)
            gl.clearColor(0, 0, 0, 0)
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
          }
          return
        }

        var aspect = cssWidth / Math.max(1, cssHeight)
        var near = Math.max(0.008, cam.dist * 0.008)
        var far = cam.dist * 12 + 40
        perspective(projMatrix, FOV, aspect, near, far)

        var dir = eyeToTarget()
        var eye = [
          cam.target[0] + dir[0] * cam.dist,
          cam.target[1] + dir[1] * cam.dist,
          cam.target[2] + dir[2] * cam.dist
        ]
        lookAt(viewMatrix, eye, cam.target, [0, 1, 0])
        multiply(vpMatrix, projMatrix, viewMatrix)

        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

        gl.useProgram(program)
        gl.uniformMatrix4fv(uniformVP, false, vpMatrix)
        gl.uniform3f(uniformBase, BASE_COLOR[0], BASE_COLOR[1], BASE_COLOR[2])

        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
        gl.enableVertexAttribArray(attribPos)
        gl.vertexAttribPointer(attribPos, 3, gl.FLOAT, false, 0, 0)

        gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuffer)
        gl.enableVertexAttribArray(attribNrm)
        gl.vertexAttribPointer(attribNrm, 3, gl.FLOAT, false, 0, 0)

        gl.drawArrays(gl.TRIANGLES, 0, vertexCount)

        if (measureMode || picks.length) drawOverlay()
        updateLabel()
      }

      function invalidate() {
        if (rafId || !attached) return
        rafId = requestAnimationFrame(drawFrame)
      }

      // ---------------- 交互 ----------------

      function onPointerDown(e) {
        if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey) || e.ctrlKey || e.metaKey) {
          drag = { mode: 'pan', x: e.clientX, y: e.clientY, moved: 0 }
        } else if (e.button === 0) {
          // 测量模式下左键仍是"拖动旋转"，只是没拖动就算一次取点
          drag = { mode: measureMode ? 'pick' : 'orbit', x: e.clientX, y: e.clientY, moved: 0 }
        } else {
          return
        }
        canvas.style.cursor = drag.mode === 'pan' ? 'move' : (drag.mode === 'pick' ? 'crosshair' : 'grabbing')
        try { canvas.focus({ preventScroll: true }) } catch (e2) {}
        e.preventDefault()
      }

      function onPointerMove(e) {
        if (!drag) {
          if (measureMode && picks.length === 1) {
            hoverAt(e.clientX, e.clientY)
            invalidate()
          }
          return
        }
        var dx = e.clientX - drag.x
        var dy = e.clientY - drag.y
        drag.x = e.clientX
        drag.y = e.clientY
        drag.moved += Math.abs(dx) + Math.abs(dy)
        if (dx === 0 && dy === 0) return
        if (drag.mode === 'pan') pan(dx, dy)
        else orbit(dx, dy)
        if (measureMode && picks.length === 1) hoverAt(e.clientX, e.clientY)
        e.preventDefault()
      }

      function onPointerUp(e) {
        if (!drag) return
        var wasPick = drag.mode === 'pick'
        var moved = drag.moved
        var x = e && typeof e.clientX === 'number' ? e.clientX : drag.x
        var y = e && typeof e.clientY === 'number' ? e.clientY : drag.y
        var cancelled = !!(e && e.type === 'pointercancel')
        drag = null
        canvas.style.cursor = measureMode ? 'crosshair' : 'grab'
        if (wasPick && !cancelled && moved < 4) addPick(x, y)
      }

      function onWheel(e) {
        e.preventDefault()
        var delta = e.deltaY
        if (e.deltaMode === 1) delta *= 16
        else if (e.deltaMode === 2) delta *= 100
        zoom(delta)
      }

      function onDoubleClick(e) {
        e.preventDefault()
        resetCamera()
      }

      function onContextMenu(e) {
        e.preventDefault()
      }

      function onKeyDown(e) {
        if (e.key === 'Escape') {
          if (measureMode || picks.length) {
            e.preventDefault()
            measureMode = false
            picks = []
            hover = null
            canvas.style.cursor = 'grab'
            updateLabel()
            invalidate()
            notifyMeasure()
          }
          return
        }
        if (e.key === 'm' || e.key === 'M') {
          e.preventDefault()
          setMeasureMode(!measureMode)
          return
        }
        if (e.key === 'r' || e.key === 'R' || e.key === '0') {
          e.preventDefault()
          resetCamera()
        }
      }

      function bind(el, type, fn, opts) {
        el.addEventListener(type, fn, opts)
        return function () {
          try { el.removeEventListener(type, fn, opts) } catch (e) {}
        }
      }

      var unbinders = []

      function attach() {
        if (attached) return
        attached = true
        // 永久监听：pointermove/up 挂 window，拖动移出画布也不会断
        unbinders = [
          bind(canvas, 'pointerdown', onPointerDown),
          bind(window, 'pointermove', onPointerMove),
          bind(window, 'pointerup', onPointerUp),
          bind(window, 'pointercancel', onPointerUp),
          bind(canvas, 'wheel', onWheel, { passive: false }),
          bind(canvas, 'dblclick', onDoubleClick),
          bind(canvas, 'contextmenu', onContextMenu),
          bind(canvas, 'keydown', onKeyDown)
        ]
        if (typeof canvas.setAttribute === 'function') {
          canvas.setAttribute('tabindex', '0')
        }
        canvas.style.cursor = measureMode ? 'crosshair' : 'grab'
        ensureGl()
        resize()
        invalidate()
      }

      function detach() {
        if (!attached) return
        attached = false
        drag = null
        for (var i = 0; i < unbinders.length; i++) unbinders[i]()
        unbinders = []
        if (rafId) {
          cancelAnimationFrame(rafId)
          rafId = 0
        }
        drawQueued = false
      }

      function dispose() {
        detach()
        if (gl) {
          try {
            var lose = gl.getExtension('WEBGL_lose_context')
            if (lose) lose.loseContext()
          } catch (e) {}
        }
        gl = null
        program = null
        overlayProgram = null
        posBuffer = null
        nrmBuffer = null
        overlayBuffer = null
        vertexCount = 0
        picks = []
        hover = null
        measureMode = false
      }

      return {
        gl: function () { return gl },
        ensureGl: ensureGl,
        setMesh: setMesh,
        resetCamera: resetCamera,
        resize: resize,
        invalidate: invalidate,
        attach: attach,
        detach: detach,
        dispose: dispose,
        // 测量
        setMeasureMode: setMeasureMode,
        clearMeasure: clearMeasure,
        setLabelEls: setLabelEls,
        onMeasureChange: onMeasureChange,
        isMeasuring: function () { return measureMode }
      }
    }

    // ==================================================================
    // React 组件
    // ==================================================================

    var ROOT_STYLE = {
      position: 'relative',
      width: '100%',
      height: '100%',
      minHeight: '260px',
      overflow: 'hidden',
      display: 'block',
      contain: 'paint'
    }

    var BACKDROP_STYLE = {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background:
        'radial-gradient(115% 95% at 32% 18%, rgba(126,158,224,0.16), rgba(126,158,224,0.02) 55%, rgba(0,0,0,0) 78%)'
    }

    var CANVAS_STYLE = {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      display: 'block',
      cursor: 'grab',
      touchAction: 'none',
      outline: 'none'
    }

    var TOPBAR_STYLE = {
      position: 'absolute',
      top: '8px',
      right: '8px',
      display: 'flex',
      gap: '6px',
      pointerEvents: 'none',
      zIndex: 3
    }

    var BUTTON_STYLE = {
      pointerEvents: 'auto',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '24px',
      padding: '0 9px',
      borderRadius: '7px',
      border: '1px solid rgba(128,128,128,0.34)',
      background: 'rgba(128,128,128,0.14)',
      color: 'inherit',
      font: 'inherit',
      fontSize: '11px',
      lineHeight: '1',
      cursor: 'pointer',
      userSelect: 'none',
      whiteSpace: 'nowrap'
    }

    // 测量模式下的按钮高亮（叠加在 BUTTON_STYLE 上）
    var BUTTON_ON_STYLE = {
      borderColor: 'rgba(255,173,76,0.72)',
      background: 'rgba(255,173,76,0.22)'
    }

    var LABEL_STYLE = {
      position: 'absolute',
      display: 'none',
      transform: 'translate(-50%, -100%)',
      padding: '4px 7px',
      borderRadius: '7px',
      border: '1px solid rgba(255,173,76,0.55)',
      background: 'rgba(22,22,24,0.80)',
      color: '#ffe1bb',
      font: 'inherit',
      lineHeight: '1.35',
      textAlign: 'center',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: 3
    }

    var LABEL_DIST_STYLE = {
      display: 'block',
      fontSize: '12px',
      fontWeight: '600',
      letterSpacing: '0.01em'
    }

    var LABEL_DELTA_STYLE = {
      display: 'block',
      fontSize: '10px',
      opacity: 0.66
    }

    var STATS_STYLE = {
      position: 'absolute',
      left: '10px',
      bottom: '8px',
      pointerEvents: 'none',
      font: 'inherit',
      fontSize: '10.5px',
      lineHeight: '1.45',
      opacity: 0.62,
      color: 'inherit',
      whiteSpace: 'nowrap',
      zIndex: 2
    }

    var HINT_STYLE = {
      position: 'absolute',
      right: '10px',
      bottom: '8px',
      pointerEvents: 'none',
      font: 'inherit',
      fontSize: '10.5px',
      lineHeight: '1.45',
      opacity: 0.45,
      color: 'inherit',
      textAlign: 'right',
      whiteSpace: 'nowrap',
      zIndex: 2
    }

    var OVERLAY_STYLE = {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px',
      padding: '18px',
      textAlign: 'center',
      font: 'inherit',
      fontSize: '12px',
      lineHeight: '1.6',
      color: 'inherit',
      background: 'rgba(128,128,128,0.06)',
      backdropFilter: 'blur(1px)',
      zIndex: 4,
      pointerEvents: 'auto'
    }

    var ERROR_TEXT_STYLE = {
      maxWidth: '320px',
      opacity: 0.82,
      wordBreak: 'break-word'
    }

    function toBytes(source) {
      if (!source) return null
      if (source instanceof ArrayBuffer) return new Uint8Array(source)
      if (ArrayBuffer.isView(source)) {
        return new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      }
      if (typeof source === 'string') return new TextEncoder().encode(source)
      return null
    }

    function StlViewer(props) {
      var containerRef = useRef(null)
      var canvasRef = useRef(null)
      var viewerRef = useRef(null)
      var labelRef = useRef(null)
      var distRef = useRef(null)
      var deltaRef = useRef(null)
      var propsRef = useRef(props)
      propsRef.current = props

      var [phase, setPhase] = useState('loading')
      var [message, setMessage] = useState('')
      var [stats, setStats] = useState(null)
      var [attempt, setAttempt] = useState(0)
      var [measuring, setMeasuring] = useState(false)

      var mediaUrl = props.mediaUrl
      var filePath = props.path
      var visible = props.visible !== false

      // 挂载：拿（或复用）渲染器，接上 ResizeObserver
      useEffect(function () {
        var canvas = canvasRef.current
        var container = containerRef.current
        if (!canvas) return

        var viewer = canvas.__dshStlViewer
        if (!viewer) {
          viewer = createViewer(canvas)
          canvas.__dshStlViewer = viewer
        }
        viewerRef.current = viewer
        viewer.attach()
        viewer.resize()

        var cleanup = []
        if (typeof ResizeObserver === 'function' && container) {
          var ro = new ResizeObserver(function () {
            viewer.resize()
          })
          ro.observe(container)
          cleanup.push(function () { ro.disconnect() })
        } else {
          var onResize = function () { viewer.resize() }
          window.addEventListener('resize', onResize)
          cleanup.push(function () { window.removeEventListener('resize', onResize) })
        }

        return function () {
          for (var i = 0; i < cleanup.length; i++) cleanup[i]()
          viewer.detach()
        }
      }, [])

      // 测量的两个挂接点：数值标签交给渲染器直接定位（跟相机走，不惊动 React），
      // 状态变化（Esc / 按钮）再回灌进来点亮按钮。
      useEffect(function () {
        var viewer = viewerRef.current
        if (!viewer) return
        viewer.setLabelEls(labelRef.current, distRef.current, deltaRef.current)
        viewer.onMeasureChange(function (on) { setMeasuring(!!on) })
        return function () {
          viewer.onMeasureChange(null)
          viewer.setLabelEls(null, null, null)
        }
      }, [])

      // 测量中按 Esc 退出（画布不一定有焦点，所以挂到 window）
      useEffect(function () {
        if (!measuring) return
        var onKey = function (e) {
          if (e.key !== 'Escape') return
          var viewer = viewerRef.current
          if (viewer) viewer.setMeasureMode(false)
        }
        window.addEventListener('keydown', onKey)
        return function () { window.removeEventListener('keydown', onKey) }
      }, [measuring])

      // 可见性：切回这个标签页时补一次尺寸 + 重绘
      useEffect(function () {
        var viewer = viewerRef.current
        if (!viewer) return
        if (visible) {
          viewer.resize()
          viewer.invalidate()
        }
      }, [visible])

      // 读字节 → 解析 → 喂给渲染器
      useEffect(function () {
        var alive = true
        setPhase('loading')
        setMessage('')

        var current = propsRef.current
        var url = current.mediaUrl
        var inline = toBytes(current.content)

        var pending
        if (url) {
          pending = fetch(url, { credentials: 'same-origin' }).then(function (res) {
            if (!res.ok) {
              throw new Error('HTTP ' + res.status + ' ' + res.statusText)
            }
            return res.arrayBuffer()
          }).then(function (buffer) {
            return new Uint8Array(buffer)
          })
        } else if (inline) {
          pending = Promise.resolve(inline)
        } else {
          pending = Promise.reject(new Error('no file source'))
        }

        pending.then(function (bytes) {
          if (!alive) return
          var parsed = parseStl(bytes)
          if (!alive) return

          var viewer = viewerRef.current
          if (viewer) {
            if (!viewer.ensureGl()) {
              setPhase('error')
              setMessage(t('webglFailed'))
              return
            }
            viewer.setMesh(parsed)
            viewer.resize()
            viewer.invalidate()
          }

          setStats({
            triangles: parsed.triangleCount,
            dims: parsed.dims
          })
          setPhase('ready')
        }).catch(function (err) {
          if (!alive) return
          var detail = err && err.message ? err.message : String(err)
          setPhase('error')
          setMessage(t('loadFailed') + '：' + detail)
        })

        return function () { alive = false }
      }, [mediaUrl, filePath, attempt])

      var onRetry = function (e) {
        if (e && e.stopPropagation) e.stopPropagation()
        setAttempt(function (n) { return n + 1 })
      }

      var onReset = function (e) {
        if (e && e.stopPropagation) e.stopPropagation()
        var viewer = viewerRef.current
        if (viewer) viewer.resetCamera()
      }

      var onMeasure = function (e) {
        if (e && e.stopPropagation) e.stopPropagation()
        var viewer = viewerRef.current
        if (!viewer) return
        viewer.setMeasureMode(!viewer.isMeasuring())
        setMeasuring(viewer.isMeasuring())
      }

      var children = [
        h('div', { key: 'backdrop', style: BACKDROP_STYLE }),
        h('canvas', {
          key: 'canvas',
          ref: canvasRef,
          style: CANVAS_STYLE,
          'aria-label': filePath || t('title')
        }),
        phase === 'ready'
          ? h('div', { key: 'topbar', style: TOPBAR_STYLE },
              h('button', {
                type: 'button',
                key: 'measure',
                style: measuring ? merge(BUTTON_STYLE, BUTTON_ON_STYLE) : BUTTON_STYLE,
                'aria-pressed': measuring ? 'true' : 'false',
                title: t('measure') + ' (M)',
                onClick: onMeasure
              }, t('measure')),
              h('button', {
                type: 'button',
                key: 'reset',
                style: BUTTON_STYLE,
                title: t('reset') + ' (R)',
                onClick: onReset
              }, t('reset')))
          : null,
        h('div', { key: 'label', ref: labelRef, style: LABEL_STYLE },
          h('span', { key: 'dist', ref: distRef, style: LABEL_DIST_STYLE }),
          h('span', { key: 'delta', ref: deltaRef, style: LABEL_DELTA_STYLE })),
        phase === 'ready'
          ? h('div', { key: 'stats', style: STATS_STYLE },
              thousands(stats ? stats.triangles : 0) + ' ' + t('triangles') +
              (stats ? ' · ' + t('size') + ' ' +
                fmtDim(stats.dims[0]) + ' × ' + fmtDim(stats.dims[1]) + ' × ' + fmtDim(stats.dims[2]) : ''))
          : null,
        phase === 'ready'
          ? h('div', { key: 'hint', style: HINT_STYLE }, measuring ? t('measureHint') : t('hint'))
          : null,
        phase === 'loading'
          ? h('div', { key: 'loading', style: OVERLAY_STYLE }, h('span', null, t('reading')))
          : null,
        phase === 'error'
          ? h('div', { key: 'error', style: OVERLAY_STYLE },
              h('div', { style: ERROR_TEXT_STYLE }, message),
              h('button', { type: 'button', style: BUTTON_STYLE, onClick: onRetry }, t('retry')))
          : null
      ]

      return h('div', { ref: containerRef, style: ROOT_STYLE, className: 'dsh-stl-viewer' }, children)
    }

    // ==================================================================
    // 注册
    // ==================================================================

    function cubeIcon(size) {
      var s = typeof size === 'number' && size > 0 ? size : 16
      return h('svg', {
        width: s,
        height: s,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
        style: { display: 'block' }
      },
        h('path', {
          d: 'M8 1.6 14 5v6L8 14.4 2 11V5l6-3.4Z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round'
        }),
        h('path', {
          d: 'M2 5l6 3.4L14 5M8 8.4V14.4',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round'
        })
      )
    }

    function describe() {
      return {
        id: 'dsh-stl-viewer:stl',
        title: function () { return t('title') },
        icon: function (size) { return cubeIcon(size) },
        exts: ['stl'],
        priority: 10,
        fetchStrategy: 'mediaUrl',
        component: StlViewer
      }
    }

    function resolveService(ctx) {
      if (!ctx) return null
      try {
        if (ctx.betterSidebar) return ctx.betterSidebar
      } catch (e) {}
      try {
        if (typeof ctx.get === 'function') {
          var found = ctx.get('betterSidebar')
          if (found) return found
        }
      } catch (e2) {}
      return null
    }

    function apply(ctx) {
      var disposer = null
      var iconDisposer = null
      var timer = 0
      var tries = 0
      var disposed = false

      function teardown() {
        if (timer) {
          clearInterval(timer)
          timer = 0
        }
        if (iconDisposer) {
          try { iconDisposer() } catch (e) {}
          iconDisposer = null
        }
        if (disposer) {
          try { disposer() } catch (e) {}
          disposer = null
        }
      }

      function tryInstall() {
        if (disposed || disposer) return true
        var service = resolveService(ctx)
        if (!service || typeof service.registerFileViewer !== 'function') return false
        try {
          disposer = service.registerFileViewer(describe())
        } catch (e) {
          console.error('[dsh-stl-viewer] registerFileViewer failed', e)
          disposer = null
          return true // 别无限重试一个必然失败的注册
        }
        try {
          if (typeof service.registerFileIcon === 'function') {
            iconDisposer = service.registerFileIcon({
              id: 'dsh-stl-viewer:icons',
              exts: ['stl'],
              priority: 10,
              icon: function (path, size) { return cubeIcon(size) }
            })
          }
        } catch (e2) {
          iconDisposer = null
        }
        return true
      }

      if (tryInstall()) {
        return function () {
          disposed = true
          teardown()
        }
      }

      // faster-sidebar 还没发布服务：短暂轮询，最多 ~15s
      timer = setInterval(function () {
        tries += 1
        if (tryInstall() || tries > 75) {
          clearInterval(timer)
          timer = 0
          if (tries > 75) {
            console.warn('[dsh-stl-viewer] betterSidebar service not found; STL preview inactive')
          }
        }
      }, 200)

      return function () {
        disposed = true
        teardown()
      }
    }

    return {
      name: 'dsh-stl-viewer',
      apply: apply
    }
  }
})
