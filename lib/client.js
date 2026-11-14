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
      hint: '左键拖动旋转 · 滚轮缩放 · 右键拖动平移 · 双击复位'
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
      hint: 'Drag to orbit · wheel to zoom · right-drag to pan · double-click to reset'
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
        radius: Math.sqrt(hx * hx + hy * hy + hz * hz) || 1
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
        if (!gl) return
        uploadMesh()
        invalidate()
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
      }

      function invalidate() {
        if (rafId || !attached) return
        rafId = requestAnimationFrame(drawFrame)
      }

      // ---------------- 交互 ----------------

      function onPointerDown(e) {
        if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey) || e.ctrlKey || e.metaKey) {
          drag = { mode: 'pan', x: e.clientX, y: e.clientY }
        } else if (e.button === 0) {
          drag = { mode: 'orbit', x: e.clientX, y: e.clientY }
        } else {
          return
        }
        canvas.style.cursor = drag.mode === 'orbit' ? 'grabbing' : 'move'
        try { canvas.focus({ preventScroll: true }) } catch (e2) {}
        e.preventDefault()
      }

      function onPointerMove(e) {
        if (!drag) return
        var dx = e.clientX - drag.x
        var dy = e.clientY - drag.y
        drag.x = e.clientX
        drag.y = e.clientY
        if (dx === 0 && dy === 0) return
        if (drag.mode === 'orbit') orbit(dx, dy)
        else pan(dx, dy)
        e.preventDefault()
      }

      function onPointerUp() {
        if (!drag) return
        drag = null
        canvas.style.cursor = 'grab'
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
        canvas.style.cursor = 'grab'
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
        posBuffer = null
        nrmBuffer = null
        vertexCount = 0
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
        dispose: dispose
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
      var propsRef = useRef(props)
      propsRef.current = props

      var [phase, setPhase] = useState('loading')
      var [message, setMessage] = useState('')
      var [stats, setStats] = useState(null)
      var [attempt, setAttempt] = useState(0)

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
                style: BUTTON_STYLE,
                title: t('reset') + ' (R)',
                onClick: onReset
              }, t('reset')))
          : null,
        phase === 'ready'
          ? h('div', { key: 'stats', style: STATS_STYLE },
              thousands(stats ? stats.triangles : 0) + ' ' + t('triangles') +
              (stats ? ' · ' + t('size') + ' ' +
                fmtDim(stats.dims[0]) + ' × ' + fmtDim(stats.dims[1]) + ' × ' + fmtDim(stats.dims[2]) : ''))
          : null,
        phase === 'ready'
          ? h('div', { key: 'hint', style: HINT_STYLE }, t('hint'))
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
