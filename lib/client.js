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
      title: 'STL / STEP 三维预览',
      reading: '正在解析 STL…',
      converting: '正在转换 STEP',
      convertingHint: '第一次打开最慢，同一个文件会缓存',
      cancelled: '已取消转换',
      cancel: '取消',
      stepFailed: 'STEP 转换失败。',
      stepUnavailable: 'STEP 转换不可用：宿主半侧没有加载，重启 DSH 后再试。',
      stepTooLarge: '文件太大，STEP 上限 128 MB。',
      parts: '个零件',
      parseFailed: '无法解析这个 STL 文件（既不是二进制也不是 ASCII）。',
      loadFailed: '读取文件失败',
      webglFailed: '当前环境不支持 WebGL，无法渲染三维模型。',
      empty: '这个 STL 里没有三角面。',
      triangles: '三角面',
      size: '尺寸',
      reset: '复位视角',
      retry: '重试',
      hint: '左键拖动旋转 · 滚轮缩放 · 右键拖动平移 · M 测量 · 双击复位',
      measure: '测量',
      measureHint: '点顶点 / 边 / 面 / 圆来测量 · Shift 点取任意点 · 拖动仍可旋转 · Esc 退出',
      pickSecond: '再点一个点、边、面或圆',
      ptToPt: '点到点',
      ptToEdge: '点到边',
      ptToFace: '点到面',
      edgeToEdge: '边到边',
      edgeToFace: '边到面',
      faceToFace: '面到面',
      parallelFaces: '平行面间距',
      angleFaces: '夹角',
      spacing: '间距',
      circle: '圆',
      diameter: '直径',
      radius: '半径',
      centerDist: '圆心距',
      distance: '距离',
      point: '点',
      edge: '棱',
      face: '面',
      circleToPoint: '圆到点',
      circleToEdge: '圆到边',
      circleToFace: '圆到面',
      circleToCircle: '圆到圆',
      volume: '体积',
      area: '表面积',
      notClosed: '未闭合',
      views: '视图',
      viewFront: '正视',
      viewTop: '俯视',
      viewRight: '右视',
      viewIso: '等轴',
      wire: '线框',
      spin: '自动旋转',
      axes: '坐标轴',
      save: '保存图片',
      help: '快捷键',
      language: '语言',
      helpRows: [
        '左键拖动 — 旋转',
        '滚轮 — 缩放',
        '右键拖动 — 平移',
        '双击 / R — 复位视角',
        'M — 测量',
        'Esc — 退出测量',
        'W — 线框',
        'A — 自动旋转',
        'G — 坐标轴',
        '1 / 2 / 3 / 4 — 正视 / 俯视 / 右视 / 等轴'
      ],
      unit: 'mm',
      // 装配体运动
      motion: '运动',
      motionHint: '点零件选中 · 拖动仍是转视角 · Esc 退出',
      explode: '分解',
      explodePlay: '播放分解',
      explodeStop: '合拢',
      parts: '个零件',
      part: '零件',
      partAuto: '自动',
      axisLabel: '回转轴',
      speed: '转速',
      speedUnit: '转/分',
      motionReset: '全部复位',
      couple: '联动',
      coupleOn: '开',
      coupleOff: '关',
      teeth: '齿数',
      motionSingle: '这个装配体只有一个零件，分解看不出结构；给零件加速度可以看它转起来。'
    }

    var EN = {
      title: 'STL / STEP 3D preview',
      reading: 'Parsing STL…',
      converting: 'Converting STEP',
      convertingHint: 'The first open is the slow one — the result is cached for the next',
      cancelled: 'Conversion cancelled',
      cancel: 'Cancel',
      stepFailed: 'STEP conversion failed.',
      stepUnavailable: 'STEP conversion is unavailable — the host half is not loaded. Restart DSH and try again.',
      stepTooLarge: 'That file is too large; STEP conversion is capped at 128 MB.',
      parts: 'parts',
      parseFailed: 'This STL file could not be parsed (neither binary nor ASCII).',
      loadFailed: 'Failed to read the file',
      webglFailed: 'WebGL is unavailable, so the model cannot be rendered.',
      empty: 'This STL contains no triangles.',
      triangles: 'triangles',
      size: 'size',
      reset: 'Reset view',
      retry: 'Retry',
      hint: 'Drag to orbit · wheel to zoom · right-drag to pan · M to measure · double-click to reset',
      measure: 'Measure',
      measureHint: 'Click a vertex, edge, face or circle · Shift-click for any point · drag still orbits · Esc to exit',
      pickSecond: 'Click a second point, edge, face or circle',
      ptToPt: 'point to point',
      ptToEdge: 'point to edge',
      ptToFace: 'point to face',
      edgeToEdge: 'edge to edge',
      edgeToFace: 'edge to face',
      faceToFace: 'face to face',
      parallelFaces: 'parallel planes',
      angleFaces: 'angle',
      spacing: 'gap',
      circle: 'circle',
      diameter: 'diameter',
      radius: 'radius',
      centerDist: 'center distance',
      distance: 'distance',
      point: 'point',
      edge: 'edge',
      face: 'face',
      circleToPoint: 'circle to point',
      circleToEdge: 'circle to edge',
      circleToFace: 'circle to face',
      circleToCircle: 'circle to circle',
      volume: 'volume',
      area: 'surface',
      notClosed: 'not closed',
      views: 'View',
      viewFront: 'Front',
      viewTop: 'Top',
      viewRight: 'Right',
      viewIso: 'Iso',
      wire: 'Wireframe',
      spin: 'Turntable',
      axes: 'Axes',
      save: 'Save image',
      help: 'Shortcuts',
      language: 'Language',
      helpRows: [
        'drag — orbit',
        'wheel — zoom',
        'right-drag — pan',
        'double-click / R — reset',
        'M — measure',
        'Esc — leave measuring',
        'W — wireframe',
        'A — turntable',
        'G — axes',
        '1 / 2 / 3 / 4 — front / top / right / iso'
      ],
      unit: 'mm',
      // assembly motion
      motion: 'Motion',
      motionHint: 'click a part to select · dragging still orbits · Esc to exit',
      explode: 'Explode',
      explodePlay: 'Play explode',
      explodeStop: 'Collapse',
      parts: 'parts',
      part: 'Part',
      partAuto: 'Auto',
      axisLabel: 'Axis',
      speed: 'Speed',
      speedUnit: 'rpm',
      motionReset: 'Reset all',
      couple: 'Gear train',
      coupleOn: 'on',
      coupleOff: 'off',
      teeth: 'Teeth',
      motionSingle: 'This assembly has a single part, so exploding shows nothing; give the part a speed to watch it turn.'
    }

    // 界面语言。三条规则，从强到弱：
    //   1. 视图菜单里手动切过的（写 localStorage）
    //   2. 应用自己是中文界面（<html lang> 被 dsh-client-locale 同步成 zh-CN）
    //   3. 应用是英文界面、但系统语言是中文 —— 面板跟着系统走中文，
    //      因为读得懂英文界面的人不一定想读英文读数
    // 都不是就退回英文；判断失败时保守用中文（作者自己是中文用户）。
    var LANG_KEY = 'dsh-stl-viewer:lang'
    var LANG = 'zh'
    var langListeners = []

    function appLangTag() {
      try {
        return String(
          (document.documentElement && document.documentElement.getAttribute('lang')) ||
          navigator.language || ''
        ).toLowerCase()
      } catch (e) {
        return ''
      }
    }

    function systemSpeaksChinese() {
      try {
        var list = []
        if (navigator.languages && navigator.languages.length) {
          for (var i = 0; i < navigator.languages.length; i++) list.push(navigator.languages[i])
        }
        if (navigator.language) list.push(navigator.language)
        for (var k = 0; k < list.length; k++) {
          if (String(list[k] || '').toLowerCase().indexOf('zh') === 0) return true
        }
      } catch (e) { /* 没有 navigator 就当不是 */ }
      return false
    }

    function storedLang() {
      try {
        var saved = window.localStorage.getItem(LANG_KEY)
        return saved === 'zh' || saved === 'en' ? saved : ''
      } catch (e) {
        return ''
      }
    }

    function detectLang() {
      var saved = storedLang()
      if (saved) return saved
      var tag = appLangTag()
      if (tag.indexOf('zh') === 0) return 'zh'
      if (systemSpeaksChinese()) return 'zh'
      if (tag.indexOf('en') === 0) return 'en'
      return 'zh'
    }

    function getLang() {
      return LANG
    }

    // 切语言：记住选择并通知界面重画（文案是渲染时逐条查表的，重画即可）
    function setLang(next) {
      var wanted = next === 'en' ? 'en' : 'zh'
      if (wanted === LANG) return LANG
      LANG = wanted
      try { window.localStorage.setItem(LANG_KEY, wanted) } catch (e) { /* 隐私模式就算了 */ }
      for (var i = 0; i < langListeners.length; i++) {
        try { langListeners[i](LANG) } catch (e) { /* 单个订阅者出错不影响别人 */ }
      }
      return LANG
    }

    function onLangChange(fn) {
      langListeners = fn ? [fn] : []
    }

    LANG = detectLang()

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

    // 视角 = 基础朝向（yaw/pitch，供视角预设与补间用）再叠一个四元数 cam.q。
    // 拖动只往 cam.q 上累乘，所以可以 360° 任意翻滚：俯仰没有 ±90° 的墙，
    // 也没有"越过极点要翻转经纬度"的病态。渲染、拾取、平移、三脚标都走
    // camBasis() 这一套基，不会各算各的。
    var ORBIT_SPEED = 0.008

    function qAxisAngle(axis, angle) {
      var len = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2])
      if (!(len > 1e-9)) return [0, 0, 0, 1]
      var s = Math.sin(angle / 2) / len
      return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]
    }

    function qMultiply(a, b) {
      var ax = a[0], ay = a[1], az = a[2], aw = a[3]
      var bx = b[0], by = b[1], bz = b[2], bw = b[3]
      return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz
      ]
    }

    // v' = v + 2w(qv × v) + 2(qv × (qv × v))
    function qRotate(q, v) {
      var x = q[0], y = q[1], z = q[2], w = q[3]
      var tx = 2 * (y * v[2] - z * v[1])
      var ty = 2 * (z * v[0] - x * v[2])
      var tz = 2 * (x * v[1] - y * v[0])
      return [
        v[0] + w * tx + (y * tz - z * ty),
        v[1] + w * ty + (z * tx - x * tz),
        v[2] + w * tz + (x * ty - y * tx)
      ]
    }

    /**
     * 相机基：dir 是目标→眼睛，fwd/right/up 是视图矩阵的三个轴。
     * 基础朝向来在 yaw/pitch，再整体乘 cam.q；两者只在这里合成。
     */
    function camBasis(cam) {
      var cp = Math.cos(cam.pitch)
      var sp = Math.sin(cam.pitch)
      var d0 = [cp * Math.sin(cam.yaw), sp, cp * Math.cos(cam.yaw)]
      var q = cam.q || [0, 0, 0, 1]
      var dir = qRotate(q, d0)
      var fwd0 = [-d0[0], -d0[1], -d0[2]]
      var rl = Math.sqrt(fwd0[0] * fwd0[0] + fwd0[2] * fwd0[2])
      // 正俯视/正仰视时基准朝向竖直，水平分量退化，退回到 +X 当作右
      var right0 = rl > 1e-4 ? [-fwd0[2] / rl, 0, fwd0[0] / rl] : [1, 0, 0]
      var up0 = [
        right0[1] * fwd0[2] - right0[2] * fwd0[1],
        right0[2] * fwd0[0] - right0[0] * fwd0[2],
        right0[0] * fwd0[1] - right0[1] * fwd0[0]
      ]
      return {
        dir: dir,
        fwd: [-dir[0], -dir[1], -dir[2]],
        right: qRotate(q, right0),
        up: qRotate(q, up0)
      }
    }

    /**
     * 模型的三根轴在渲染空间的方向：finalizeMesh 做过 Z-up → Y-up，
     * 所以 model X → render +X、model Y → render −Z、model Z → render +Y。
     * 三脚标要按模型自己的轴来标，不然 CAD 里"向上"的 Z 会被写成 Y。
     */
    var MODEL_AXES = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]

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
        // 法线不用再转一次：上面求叉积时顶点已经是渲染空间（Z-up 转 Y-up 已经做过了），
        // 算出来的就是渲染空间的法线。早先这里多转了一次，箱体贴图看不出问题
        // （轴对齐法线转两次还是轴对齐），曲面模型就会顶面发黑、侧面发亮。
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

    /**
     * 体积 / 表面积 / 是否闭合。
     *
     * 顶点已经被 finalizeMesh 缩放过（最大边长 = 2），所以这里算出来的量要按
     * scale 还原回模型自己的单位：体积差 scale³，面积差 scale²。
     * 体积用散度定理 Σ a·(b×c)/6，绕向决定正负，取绝对值。
     */
    function meshInfo(positions, count, scale) {
      var s = scale > 1e-12 ? scale : 1
      var volume = 0
      var area = 0
      var tri, o
      for (tri = 0; tri < count; tri++) {
        o = tri * 9
        var ax = positions[o], ay = positions[o + 1], az = positions[o + 2]
        var bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5]
        var cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8]
        var ux = bx - ax, uy = by - ay, uz = bz - az
        var vx = cx - ax, vy = cy - ay, vz = cz - az
        var nx = uy * vz - uz * vy
        var ny = uz * vx - ux * vz
        var nz = ux * vy - uy * vx
        area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2
        volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
      }

      // 闭合：没有破面。判据是"没有任何一条边只属于一个三角形"——被三个以上
      // 面共用的边是非流形（自相交、重合面），但那样的面墙上也没有洞，不算破。
      var closed = false
      if (count <= 400000) {
        var seen = Object.create(null)
        closed = true
        for (tri = 0; tri < count; tri++) {
          o = tri * 9
          for (var e = 0; e < 3; e++) {
            var i0 = o + e * 3
            var i1 = o + ((e + 1) % 3) * 3
            var k0 = coordKey(positions[i0], positions[i0 + 1], positions[i0 + 2])
            var k1 = coordKey(positions[i1], positions[i1 + 1], positions[i1 + 2])
            var key = k0 < k1 ? k0 + '|' + k1 : k1 + '|' + k0
            seen[key] = (seen[key] || 0) + 1
          }
        }
        for (var k in seen) {
          if (seen[k] === 1) { closed = false; break }
        }
      }

      return {
        volume: Math.abs(volume) / (s * s * s),
        area: area / (s * s),
        closed: closed
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

    function parseStlRaw(bytes) {
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

    /** 解析并统计：体积 / 表面积 / 闭合性都按模型自己的单位给出。 */
    function parseStl(bytes) {
      var mesh = parseStlRaw(bytes)
      mesh.info = meshInfo(mesh.positions, mesh.triangleCount, mesh.scale)
      // STL 没有零件概念，整个文件就是一个零件
      mesh.parts = describeParts(mesh.positions, [{ name: '', start: 0, count: mesh.triangleCount }])
      return mesh
    }

    // ==================================================================
    // B-rep 格式（STEP / IGES / BREP）
    //
    // 这些是实体描述而不是三角网，浏览器里没法直接画。宿主半侧
    // （lib/index.js）用 OpenCascade 的 WASM 构建把它们转成三角面，这里只负责
    // 发字节、收网格、再走一遍和 STL 完全相同的收尾流程。
    // ==================================================================

    /** 宿主转换路由；相对路径解析，反向代理前缀与 dsh-app:// 都能落到。 */
    var CONVERT_ROUTE = 'dsh-stl-viewer/convert'

    /** STEP / IGES / BREP 走宿主转换，其余按 STL 本地解析。 */
    function isStepPath(path) {
      return /\.(step|stp|iges|igs|brep)$/i.test(String(path || ''))
    }

    /** 相对当前页面基址解析宿主路由。 */
    function hostRoute(rel) {
      try {
        if (typeof document !== 'undefined' && document.baseURI) {
          return new URL(rel, document.baseURI).href
        }
      } catch (e) { /* 退化成相对路径，浏览器自己会按页面解 */ }
      return rel
    }

    /**
     * 解开宿主回的网格包：
     *   v1 —— 16 字节头（'DSHM' + 1 + 三角面数 + 零件数）+ 顶点
     *   v2 —— 20 字节头（同上但版本 2，多 4 字节零件表长度）+ 零件表 JSON + 顶点
     * 模型坐标原样（mm、Z 向上），归一化留给 finalizeMesh。旧版本的磁盘缓存还是
     * v1，所以要能读；没有零件表时整个网格当成一个零件。
     */
    function decodeMesh(buffer) {
      if (!buffer || buffer.byteLength < 16) throw new Error(t('stepFailed'))
      var view = new DataView(buffer)
      if (view.getUint32(0, true) !== 0x4d485344) throw new Error(t('stepFailed'))
      var version = view.getUint32(4, true)
      if (version !== 1 && version !== 2) throw new Error(t('stepFailed'))
      var count = view.getUint32(8, true)
      var declared = view.getUint32(12, true)
      if (count === 0) throw new Error(t('empty'))

      var offset = 16
      var parts = null
      if (version === 2) {
        if (buffer.byteLength < 20) throw new Error(t('stepFailed'))
        var tableLength = view.getUint32(16, true)
        // 顶点必须 4 字节对齐，所以零件表在宿主侧补齐过，这里按同样规则跳过
        offset = 20 + ((tableLength + 3) & ~3)
        if (offset + count * 36 > buffer.byteLength) throw new Error(t('stepFailed'))
        var raw = new Uint8Array(buffer, 20, tableLength)
        try {
          // 宿主把零件表补齐到 4 字节，尾部会带几个 0，JSON 不认，先掐掉
          var text = new TextDecoder().decode(raw).replace(/\u0000+$/, '')
          var table = JSON.parse(text)
          parts = Array.isArray(table.parts) ? table.parts : null
        } catch (e) {
          throw new Error(t('stepFailed'))
        }
      } else if (offset + count * 36 > buffer.byteLength) {
        throw new Error(t('stepFailed'))
      }

      var positions = new Float32Array(count * 9)
      positions.set(new Float32Array(buffer, offset, count * 9))

      // 零件表可能因为格式古怪而缺项，缺了就当成一整块，绝不让它变成 undefined
      var list = []
      if (parts && parts.length) {
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i]
          var start = Math.max(0, Math.min(count, p.start | 0))
          var size = Math.max(0, Math.min(count - start, p.count | 0))
          if (size > 0) list.push({ name: String(p.name || ''), start: start, count: size })
        }
      }
      if (!list.length) list = [{ name: '', start: 0, count: count }]

      return {
        positions: positions,
        triangleCount: count,
        parts: list,
        partCount: declared
      }
    }

    /**
     * 给每个零件算出渲染空间的重心与外接球半径（顶点此时已经归一化并转成 Y-up，
     * 整机重心就在原点）。装配体要能被"分解""逐个转动"，都靠这份数据。
     */
    function describeParts(positions, ranges) {
      var out = []
      for (var i = 0; i < ranges.length; i++) {
        var r = ranges[i]
        var lo = [Infinity, Infinity, Infinity]
        var hi = [-Infinity, -Infinity, -Infinity]
        var end = (r.start + r.count) * 9
        for (var o = r.start * 9; o < end; o += 3) {
          for (var k = 0; k < 3; k++) {
            var v = positions[o + k]
            if (v < lo[k]) lo[k] = v
            if (v > hi[k]) hi[k] = v
          }
        }
        var center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
        var hx = (hi[0] - lo[0]) / 2
        var hy = (hi[1] - lo[1]) / 2
        var hz = (hi[2] - lo[2]) / 2
        // 最扁的那根轴就是回转轴：齿轮、轮子、桨叶都是这样躺着的
        var extents = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]
        var flat = 0
        if (extents[1] < extents[flat]) flat = 1
        if (extents[2] < extents[flat]) flat = 2
        out.push({
          index: i,
          name: r.name || '',
          start: r.start,
          count: r.count,
          center: center,
          lo: lo,
          hi: hi,
          extent: extents,
          radius: Math.sqrt(hx * hx + hy * hy + hz * hz) || 0.01,
          flat: flat,
          // 运动状态：axis 是 MODEL_AXES 的下标，-1 表示"自动"（用最扁的轴）；
          // speed 是每秒转多少圈，angle 是当前累积角度
          axis: -1,
          teeth: 0,
          speed: 0,
          angle: 0
        })
      }
      return out
    }

    /**
     * 找啮合关系。齿轮啮合的两个条件都能从几何上量出来：
     *   ① 两根回转轴平行（"最扁的那根轴"相同）、轴向有重叠；
     *   ② 中心距 ≈ 两个齿顶半径之和（外啮合，齿是互相插进去的，所以略小于和）。
     * 齿顶高 = (rA + rB - d) / 2，分度半径 = 齿顶半径 - 齿顶高，
     * 于是 传动比 = 分度半径反比。168 齿 / 32 齿这一对量出来正好 84 : 16 = 5.25。
     */
    function describeGears(positions, parts) {
      var out = { parts: [], pairs: [] }
      if (!parts || parts.length < 2 || !positions) return out

      /** 零件在轴向 [lo, hi] 之间的最大半径（顶点都落在特征边界上，直接取最大值）。 */
      function radiusBetween(p, lo, hi) {
        var u = (p.flat + 1) % 3
        var w = (p.flat + 2) % 3
        var best = 0
        for (var o = p.start * 9; o < (p.start + p.count) * 9; o += 3) {
          var y = positions[o + p.flat]
          if (y < lo || y > hi) continue
          var dx = positions[o + u] - p.center[u]
          var dz = positions[o + w] - p.center[w]
          var r = Math.sqrt(dx * dx + dz * dz)
          if (r > best) best = r
        }
        return best
      }

      for (var i = 0; i < parts.length; i++) {
        var p = parts[i]
        var half = 0.5 * (p.extent ? p.extent[p.flat] : 0)
        var lo = p.lo ? p.lo[p.flat] : p.center[p.flat] - half
        var hi = p.hi ? p.hi[p.flat] : p.center[p.flat] + half
        out.parts.push({
          index: i,
          axis: p.flat,
          center: p.center,
          half: half,
          lo: lo,
          hi: hi,
          radius: radiusBetween(p, -Infinity, Infinity)
        })
      }

      for (var a = 0; a < out.parts.length; a++) {
        var A = out.parts[a]
        for (var b = a + 1; b < out.parts.length; b++) {
          var B = out.parts[b]
          if (A.axis !== B.axis) continue
          var ax = A.axis
          var uu = (ax + 1) % 3
          var ww = (ax + 2) % 3
          var oLo = Math.max(A.lo, B.lo)
          var oHi = Math.min(A.hi, B.hi)
          // 轴向得挨上：阈值全部按零件自身尺寸取，渲染空间里模型只有两个单位
          if (!(oHi - oLo > 0.1 * Math.min(A.half, B.half))) continue
          var ra = radiusBetween(parts[a], oLo, oHi)
          var rb = radiusBetween(parts[b], oLo, oHi)
          if (!(ra > 0) || !(rb > 0)) continue
          var du = A.center[uu] - B.center[uu]
          var dw = A.center[ww] - B.center[ww]
          var d = Math.sqrt(du * du + dw * dw)
          if (!(d > 0)) continue
          var sum = ra + rb
          var small = Math.min(ra, rb)
          // 齿顶圆最多互相插进去两三颗齿；再远一点就不是一对啮合件
          if (!(Math.abs(d - sum) <= 0.25 * small)) continue
          var addendum = 0.5 * (sum - d)
          if (addendum < -0.1 * small || addendum > 0.3 * small) continue
          var pitchA = ra - addendum
          var pitchB = rb - addendum
          if (!(pitchA > 0) || !(pitchB > 0)) continue
          out.pairs.push({
            a: a,
            b: b,
            ratio: pitchA / pitchB,
            pitchA: pitchA,
            pitchB: pitchB,
            ra: ra,
            rb: rb,
            distance: d,
            addendum: addendum
          })
        }
      }
      return out
    }

    /** 转换结果走和 STL 一样的收尾：居中、缩放、Z-up→Y-up、重算法线、统计。 */
    function stepMesh(decoded) {
      var mesh = finalizeMesh(decoded.positions, decoded.triangleCount)
      mesh.parts = describeParts(mesh.positions, decoded.parts || [{ name: '', start: 0, count: mesh.triangleCount }])
      mesh.info = meshInfo(mesh.positions, mesh.triangleCount, mesh.scale)
      return mesh
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
      var basis = camBasis(cam)
      var dir = basis.dir
      var eye = [
        cam.target[0] + dir[0] * cam.dist,
        cam.target[1] + dir[1] * cam.dist,
        cam.target[2] + dir[2] * cam.dist
      ]
      var fx = -dir[0], fy = -dir[1], fz = -dir[2]

      var rx = basis.right[0], ry = basis.right[1], rz = basis.right[2]
      var ux = basis.up[0], uy = basis.up[1], uz = basis.up[2]

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
    // 面到面距离：点两个面，量它们之间的最短距离（平行面就是间距）
    // 全部在渲染坐标里算，最后再换回模型坐标，数值就是图纸上的数
    // ==================================================================

    function triVerts(pos, o) {
      return [
        [pos[o], pos[o + 1], pos[o + 2]],
        [pos[o + 3], pos[o + 4], pos[o + 5]],
        [pos[o + 6], pos[o + 7], pos[o + 8]]
      ]
    }

    /** 面的单位法线 + 重心。 */
    function facePlane(pos, o) {
      var ax = pos[o], ay = pos[o + 1], az = pos[o + 2]
      var e1x = pos[o + 3] - ax, e1y = pos[o + 4] - ay, e1z = pos[o + 5] - az
      var e2x = pos[o + 6] - ax, e2y = pos[o + 7] - ay, e2z = pos[o + 8] - az
      var nx = e1y * e2z - e1z * e2y
      var ny = e1z * e2x - e1x * e2z
      var nz = e1x * e2y - e1y * e2x
      var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
      return {
        n: [nx / nl, ny / nl, nz / nl],
        c: [
          (pos[o] + pos[o + 3] + pos[o + 6]) / 3,
          (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3,
          (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3
        ]
      }
    }

    /**
     * 点到三角形的最近点（Ericson《Real-Time Collision Detection》5.1.5，
     * 用重心坐标的 Voronoi 区域划分，退化三角形也不会炸）。
     */
    function closestPointOnTri(px, py, pz, pos, o) {
      var ax = pos[o], ay = pos[o + 1], az = pos[o + 2]
      var bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5]
      var cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8]

      var abx = bx - ax, aby = by - ay, abz = bz - az
      var acx = cx - ax, acy = cy - ay, acz = cz - az
      var apx = px - ax, apy = py - ay, apz = pz - az
      var d1 = abx * apx + aby * apy + abz * apz
      var d2 = acx * apx + acy * apy + acz * apz
      if (d1 <= 0 && d2 <= 0) return [ax, ay, az]

      var bpx = px - bx, bpy = py - by, bpz = pz - bz
      var d3 = abx * bpx + aby * bpy + abz * bpz
      var d4 = acx * bpx + acy * bpy + acz * bpz
      if (d3 >= 0 && d4 <= d3) return [bx, by, bz]

      var vc = d1 * d4 - d3 * d2
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        var v = d1 / ((d1 - d3) || 1e-12)
        return [ax + abx * v, ay + aby * v, az + abz * v]
      }

      var cpx = px - cx, cpy = py - cy, cpz = pz - cz
      var d5 = abx * cpx + aby * cpy + abz * cpz
      var d6 = acx * cpx + acy * cpy + acz * cpz
      if (d6 >= 0 && d5 <= d6) return [cx, cy, cz]

      var vb = d5 * d2 - d1 * d6
      if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        var w = d2 / ((d2 - d6) || 1e-12)
        return [ax + acx * w, ay + acy * w, az + acz * w]
      }

      var va = d3 * d6 - d5 * d4
      if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        var w2 = (d4 - d3) / (((d4 - d3) + (d5 - d6)) || 1e-12)
        return [bx + (cx - bx) * w2, by + (cy - by) * w2, bz + (cz - bz) * w2]
      }

      var denom = va + vb + vc
      if (!denom) denom = 1e-12
      var vv = vb / denom
      var ww = vc / denom
      return [
        ax + abx * vv + acx * ww,
        ay + aby * vv + acy * ww,
        az + abz * vv + acz * ww
      ]
    }

    /** 两条线段之间的最近点对（Ericson 5.1.9；退化时退回到端点比较）。 */
    function closestSegments(p0, p1, q0, q1) {
      var d1x = p1[0] - p0[0], d1y = p1[1] - p0[1], d1z = p1[2] - p0[2]
      var d2x = q1[0] - q0[0], d2y = q1[1] - q0[1], d2z = q1[2] - q0[2]
      var rx = p0[0] - q0[0], ry = p0[1] - q0[1], rz = p0[2] - q0[2]

      var a = d1x * d1x + d1y * d1y + d1z * d1z
      var e = d2x * d2x + d2y * d2y + d2z * d2z
      var f = d2x * rx + d2y * ry + d2z * rz
      var c = d1x * rx + d1y * ry + d1z * rz
      var b = d1x * d2x + d1y * d2y + d1z * d2z
      var denom = a * e - b * b

      var s
      if (denom > 1e-12) s = clamp((b * f - c * e) / denom, 0, 1)
      else s = 0
      var t = e > 1e-12 ? (b * s + f) / e : 0

      if (t < 0) {
        t = 0
        s = a > 1e-12 ? clamp(-c / a, 0, 1) : 0
      } else if (t > 1) {
        t = 1
        s = a > 1e-12 ? clamp((b - c) / a, 0, 1) : 0
      }

      var pa = [p0[0] + d1x * s, p0[1] + d1y * s, p0[2] + d1z * s]
      var pb = [q0[0] + d2x * t, q0[1] + d2y * t, q0[2] + d2z * t]
      var dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2]
      return { d: Math.sqrt(dx * dx + dy * dy + dz * dz), a: pa, b: pb }
    }

    /**
     * 两个三角形的最近点对：6 组"顶点 → 对面三角形" + 9 组"边 → 边"，
     * 取最小。相交、共面、部分重叠这些情况都被这 15 个候选覆盖。
     */
    function triTriDistance(pos, oa, ob) {
      var A = triVerts(pos, oa)
      var B = triVerts(pos, ob)
      var best = null

      function consider(a, b) {
        var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
        var d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (!best || d < best.d) best = { d: d, a: a, b: b }
      }

      var i, j
      for (i = 0; i < 3; i++) {
        consider(A[i], closestPointOnTri(A[i][0], A[i][1], A[i][2], pos, ob))
        consider(closestPointOnTri(B[i][0], B[i][1], B[i][2], pos, oa), B[i])
      }
      for (i = 0; i < 3; i++) {
        for (j = 0; j < 3; j++) {
          var seg = closestSegments(A[i], A[(i + 1) % 3], B[j], B[(j + 1) % 3])
          if (!best || seg.d < best.d) best = { d: seg.d, a: seg.a, b: seg.b }
        }
      }
      return best
    }

    // ==================================================================
    // 特征：STL 里没有"边"和"点"，只有一堆三角形。可拾取的棱来自相邻面
    // 夹角够大的地方（折边）或只有一面（边界）；角点就是落在这种棱上的顶点。
    // 这样鼠标在平滑曲面上滑过时不会一路吸附。
    // ==================================================================

    var EDGE_TRIS = [[0, 1], [1, 2], [2, 0]]
    var CREASE_COS = Math.cos((20 * Math.PI) / 180) // 两面夹角 > 20° 才算折边
    var SNAP_VERTEX = 12 // 光标离角点这么近（px）就吸成点
    var SNAP_EDGE = 8 // 光标离特征棱这么近（px）就吸成边
    var SNAP_CIRCLE = 14 // 光标离圆形边界这么近（px）就选中整个圆
    var TOPOLOGY_LIMIT = 400000 // 顶点数超过这个就不建特征拓扑了

    /** 顶点坐标 → 拓扑表用的 key。四舍五入到 1e-4，吸收导出器的舍入误差。 */
    function coordKey(x, y, z) {
      return Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4)
    }

    /** 一条边的 key，与两个端点的书写顺序无关。 */
    function edgeKeyOf(positions, i0, i1) {
      var ka = coordKey(positions[i0], positions[i0 + 1], positions[i0 + 2])
      var kb = coordKey(positions[i1], positions[i1 + 1], positions[i1 + 2])
      return ka < kb ? ka + '|' + kb : kb + '|' + ka
    }

    /**
     * 扫一遍网格，挑出特征棱和角点。
     * edges: 边 key → true
     * corners: 顶点 key → true（挂在特征棱上的顶点）
     * adj: 顶点 key → [{ k: 邻接顶点 key, i: 邻接顶点在 positions 里的下标 }]，
     *      用来顺着特征棱走到"一整个环"，圆形孔的内外径就是这样找出来的。
     */
    function buildFeatureTopology(positions, normals) {
      var edges = Object.create(null)
      var corners = Object.create(null)
      var adj = Object.create(null)
      var count = positions.length
      if (count / 3 > TOPOLOGY_LIMIT) return { edges: edges, corners: corners, adj: adj }
      // 每条边最多属于两个三角形；只记住第一面的法线和第二面的法线
      var map = Object.create(null)
      var o
      for (o = 0; o < count; o += 9) {
        var nx = normals[o]
        var ny = normals[o + 1]
        var nz = normals[o + 2]
        for (var e = 0; e < 3; e++) {
          var i0 = o + EDGE_TRIS[e][0] * 3
          var i1 = o + EDGE_TRIS[e][1] * 3
          var key = edgeKeyOf(positions, i0, i1)
          var rec = map[key]
          if (!rec) {
            map[key] = { n: [nx, ny, nz], a: i0, b: i1, uses: 1 }
            continue
          }
          rec.uses++
          if (!rec.n2) rec.n2 = [nx, ny, nz]
        }
      }
      for (var k in map) {
        var r = map[k]
        var crease = true
        if (r.uses === 2 && r.n2) {
          var d = r.n[0] * r.n2[0] + r.n[1] * r.n2[1] + r.n[2] * r.n2[2]
          crease = Math.abs(d) < CREASE_COS
        }
        if (!crease) continue
        edges[k] = true
        var ka = coordKey(positions[r.a], positions[r.a + 1], positions[r.a + 2])
        var kb = coordKey(positions[r.b], positions[r.b + 1], positions[r.b + 2])
        corners[ka] = true
        corners[kb] = true
        pushAdj(adj, ka, kb, r.b)
        pushAdj(adj, kb, ka, r.a)
      }
      return { edges: edges, corners: corners, adj: adj }
    }

    function pushAdj(adj, key, nextKey, nextIndex) {
      var list = adj[key]
      if (!list) {
        adj[key] = [{ k: nextKey, i: nextIndex }]
        return
      }
      list.push({ k: nextKey, i: nextIndex })
    }

    // ==================================================================
    // 圆：STL 里一个圆形孔的内外边界是一串很短的折线，单看一段完全看不出是圆。
    // 顺着特征棱走到首尾相接，再把这一圈点拟合到圆上——拟合得上才算圆。
    // 判据放在"每段中点到圆心"上：正六边形的顶点也在圆上，但它的边中点明显
    // 往里缩，所以六边形孔不会被当成圆。
    // ==================================================================

    var LOOP_LIMIT = 20000 // 顺着特征棱走一圈最多走这么多步
    var LOOP_TURN_COS = Math.cos((60 * Math.PI) / 180) // 相邻两段转角 > 60° 就当环在这里断开
    var CIRCLE_MIN_POINTS = 8 // 少于八个点的一圈不认为是圆
    var CIRCLE_FIT_TOL = 0.02 // 顶点到拟合圆的最大偏差 / 半径
    var CIRCLE_ARC_TOL = 0.06 // 每段中点到拟合圆的最大偏差 / 半径

    function pos3(positions, i) {
      return [positions[i], positions[i + 1], positions[i + 2]]
    }

    function keyPairOf(a, b) {
      return a < b ? a + '|' + b : b + '|' + a
    }

    /**
     * 从一条特征棱出发，顺着"走向最接近"的那条棱一直走到回到起点。
     * 中间遇到拐得太急的地方（方孔的四角、几条棱交汇的角点）就放弃，
     * 因为那说明这条棱不属于一个闭合的环。
     * 返回 { points: [[x,y,z],...], edgeKeys: [...] }（首尾相接），走不通返回 null。
     */
    function traceLoop(positions, adj, ia, ib) {
      if (!adj) return null
      var aKey = coordKey(positions[ia], positions[ia + 1], positions[ia + 2])
      var bKey = coordKey(positions[ib], positions[ib + 1], positions[ib + 2])
      var points = [pos3(positions, ia)]
      var edgeKeys = [keyPairOf(aKey, bKey)]
      var prevKey = aKey
      var prevI = ia
      var curKey = bKey
      var curI = ib
      for (var guard = 0; guard < LOOP_LIMIT; guard++) {
        points.push(pos3(positions, curI))
        if (curKey === aKey) return { points: points, edgeKeys: edgeKeys }
        var list = adj[curKey]
        if (!list || !list.length) return null
        var dx = positions[curI] - positions[prevI]
        var dy = positions[curI + 1] - positions[prevI + 1]
        var dz = positions[curI + 2] - positions[prevI + 2]
        var dl = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dl < 1e-9) return null
        var best = null
        var bestCos = -2
        for (var k = 0; k < list.length; k++) {
          var rec = list[k]
          if (rec.k === prevKey) continue
          var ex = positions[rec.i] - positions[curI]
          var ey = positions[rec.i + 1] - positions[curI + 1]
          var ez = positions[rec.i + 2] - positions[curI + 2]
          var el = Math.sqrt(ex * ex + ey * ey + ez * ez)
          if (el < 1e-9) continue
          var cos = (dx * ex + dy * ey + dz * ez) / (dl * el)
          if (cos > bestCos) {
            bestCos = cos
            best = rec
          }
        }
        if (!best || bestCos < LOOP_TURN_COS) return null
        edgeKeys.push(keyPairOf(curKey, best.k))
        prevKey = curKey
        prevI = curI
        curKey = best.k
        curI = best.i
      }
      return null
    }

    /** 三阶线性方程组（克莱姆法则）；退化时返回 null。 */
    function solve3(m, v) {
      function det3(a) {
        return (
          a[0] * (a[4] * a[8] - a[5] * a[7]) -
          a[1] * (a[3] * a[8] - a[5] * a[6]) +
          a[2] * (a[3] * a[7] - a[4] * a[6])
        )
      }
      var d = det3(m)
      if (!isFinite(d) || Math.abs(d) < 1e-12) return null
      function swap(col) {
        var a = m.slice()
        a[col] = v[0]
        a[col + 3] = v[1]
        a[col + 6] = v[2]
        return det3(a) / d
      }
      return [swap(0), swap(1), swap(2)]
    }

    /**
     * 把一圈点拟合到圆上。用代数最小二乘（Kåsa）：先在点云自己的平面上
     * 做二维拟合，再换回三维。拟不上（离圆太远 / 不共面）返回 null。
     */
    function fitCirclePoints(points) {
      var n = points.length
      if (n < CIRCLE_MIN_POINTS) return null
      // Newell 法求环的法线：对凹多边形也稳
      var nx = 0
      var ny = 0
      var nz = 0
      var cx0 = 0
      var cy0 = 0
      var cz0 = 0
      for (var i = 0; i < n; i++) {
        var p = points[i]
        var q = points[(i + 1) % n]
        nx += (p[1] - q[1]) * (p[2] + q[2])
        ny += (p[2] - q[2]) * (p[0] + q[0])
        nz += (p[0] - q[0]) * (p[1] + q[1])
        cx0 += p[0]
        cy0 += p[1]
        cz0 += p[2]
      }
      var nl = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (nl < 1e-12) return null
      nx /= nl; ny /= nl; nz /= nl
      cx0 /= n; cy0 /= n; cz0 /= n

      // 平面内的两个基向量
      var ux = 0
      var uy = 0
      var uz = 0
      if (Math.abs(nx) < 0.9) { ux = 1 } else { uy = 1 }
      var d0 = ux * nx + uy * ny + uz * nz
      ux -= nx * d0; uy -= ny * d0; uz -= nz * d0
      var ul = Math.sqrt(ux * ux + uy * uy + uz * uz)
      if (ul < 1e-12) return null
      ux /= ul; uy /= ul; uz /= ul
      var vx = ny * uz - nz * uy
      var vy = nz * ux - nx * uz
      var vz = nx * uy - ny * ux

      // 二维坐标 + Kåsa 的法方程
      var xs = new Float64Array(n)
      var ys = new Float64Array(n)
      var sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sx3 = 0, sy3 = 0, sxy2 = 0, sx2y = 0
      var maxOff = 0
      for (i = 0; i < n; i++) {
        var rx = points[i][0] - cx0
        var ry = points[i][1] - cy0
        var rz = points[i][2] - cz0
        var off = Math.abs(rx * nx + ry * ny + rz * nz)
        if (off > maxOff) maxOff = off
        var px = rx * ux + ry * uy + rz * uz
        var py = rx * vx + ry * vy + rz * vz
        xs[i] = px
        ys[i] = py
        sx += px; sy += py
        sxx += px * px; syy += py * py; sxy += px * py
        sx3 += px * px * px; sy3 += py * py * py
        sxy2 += px * py * py; sx2y += px * px * py
      }
      var sol = solve3(
        [sxx, sxy, sx, sxy, syy, sy, sx, sy, n],
        [-(sx3 + sxy2), -(sx2y + sy3), -(sxx + syy)]
      )
      if (!sol) return null
      var ccx = -sol[0] / 2
      var ccy = -sol[1] / 2
      var r2 = ccx * ccx + ccy * ccy - sol[2]
      if (!(r2 > 0)) return null
      var r = Math.sqrt(r2)
      if (!isFinite(r) || r <= 0) return null

      // 顶点偏差
      var maxErr = 0
      for (i = 0; i < n; i++) {
        var ddx = xs[i] - ccx
        var ddy = ys[i] - ccy
        var err = Math.abs(Math.sqrt(ddx * ddx + ddy * ddy) - r)
        if (err > maxErr) maxErr = err
      }
      if (maxErr > CIRCLE_FIT_TOL * r) return null
      if (maxOff > CIRCLE_FIT_TOL * r) return null

      // 每段中点偏差：正六边形在这里被拒
      for (i = 0; i < n; i++) {
        var j = (i + 1) % n
        var mx = (xs[i] + xs[j]) / 2 - ccx
        var my = (ys[i] + ys[j]) / 2 - ccy
        var merr = Math.abs(Math.sqrt(mx * mx + my * my) - r)
        if (merr > CIRCLE_ARC_TOL * r) return null
      }

      return {
        center: [
          cx0 + ux * ccx + vx * ccy,
          cy0 + uy * ccx + vy * ccy,
          cz0 + uz * ccx + vz * ccy
        ],
        normal: [nx, ny, nz],
        radius: r
      }
    }

    /** 一条特征棱 → 它所在的那个圆（拟合不上就是 null）。纯函数，方便单测。 */
    function circleFromEdge(positions, adj, ia, ib) {
      var loop = traceLoop(positions, adj, ia, ib)
      if (!loop) return null
      // 走回来时最后一个点就是起点
      var pts = loop.points.slice(0, loop.points.length - 1)
      var fit = fitCirclePoints(pts)
      if (!fit) return null
      fit.points = loop.points
      fit.edgeKeys = loop.edgeKeys
      return fit
    }

    /**
     * 一块面区域 → 它边界上的那些环，能拟合成圆的返回出来（数组）。
     * 圆柱孔/凸台的侧壁就是这样一个面：边界正好是上下两个同心圆。
     * offsets 是三角形在 positions 里的字节偏移（growRegion / growSmooth 的产物）。
     */
    function regionCircles(offsets, positions) {
      if (!offsets || !offsets.length) return []
      var counts = Object.create(null)
      var i, e
      for (i = 0; i < offsets.length; i++) {
        var o = offsets[i]
        for (e = 0; e < 3; e++) {
          var i0 = o + EDGE_TRIS[e][0] * 3
          var i1 = o + EDGE_TRIS[e][1] * 3
          var ka = coordKey(positions[i0], positions[i0 + 1], positions[i0 + 2])
          var kb = coordKey(positions[i1], positions[i1 + 1], positions[i1 + 2])
          var key = keyPairOf(ka, kb)
          var rec = counts[key]
          if (!rec) counts[key] = { ka: ka, kb: kb, i0: i0, i1: i1, uses: 1 }
          else rec.uses++
        }
      }
      // 只被一个三角形用到的边就是区域边界
      var adj = Object.create(null)
      var first = Object.create(null)
      var k
      for (k in counts) {
        var r = counts[k]
        if (r.uses !== 1) continue
        pushAdj(adj, r.ka, r.kb, r.i1)
        pushAdj(adj, r.kb, r.ka, r.i0)
        if (!(r.ka in first)) first[r.ka] = r.i0
        if (!(r.kb in first)) first[r.kb] = r.i1
      }
      var circles = []
      var walked = Object.create(null)
      for (k in adj) {
        var list = adj[k]
        for (var j = 0; j < list.length; j++) {
          var start = list[j]
          var edgeKey = keyPairOf(k, start.k)
          if (walked[edgeKey]) continue
          var loop = traceLoop(positions, adj, first[k], start.i)
          if (!loop) {
            walked[edgeKey] = true
            continue
          }
          for (var w = 0; w < loop.edgeKeys.length; w++) walked[loop.edgeKeys[w]] = true
          var pts = loop.points.slice(0, loop.points.length - 1)
          var fit = fitCirclePoints(pts)
          if (!fit) continue
          fit.points = loop.points
          circles.push(fit)
        }
      }
      return circles
    }

    var SMOOTH_LIMIT = 900 // 沿"不是折边"的共享边扩散，最多这么多三角形

    /**
     * 从 o 出发沿非折边扩散出整块光滑曲面：圆柱侧壁、球面、倒角带都是一整块。
     * 单独一个三角形看不出是圆的，要先拿到整块才谈得上拟合。
     */
    function growSmooth(o, positions, normals, edgeMap) {
      var region = [o]
      if (!edgeMap) return region
      var seen = Object.create(null)
      seen[o] = 1
      var stack = [o]
      while (stack.length) {
        var cur = stack.pop()
        var k0 = vertexKey(positions, cur)
        var k1 = vertexKey(positions, cur + 3)
        var k2 = vertexKey(positions, cur + 6)
        var keys = [k0 + '|' + k1, k1 + '|' + k2, k2 + '|' + k0]
        for (var e = 0; e < 3; e++) {
          var raw = keys[e].split('|')
          var k = raw[0] < raw[1] ? keys[e] : raw[1] + '|' + raw[0]
          var list = edgeMap[k]
          if (!list) continue
          for (var i = 0; i < list.length; i++) {
            var nb = list[i]
            if (seen[nb]) continue
            var d =
              normals[cur] * normals[nb] +
              normals[cur + 1] * normals[nb + 1] +
              normals[cur + 2] * normals[nb + 2]
            if (Math.abs(d) < CREASE_COS) continue // 折边：曲面到此为止
            seen[nb] = 1
            region.push(nb)
            stack.push(nb)
            if (region.length > SMOOTH_LIMIT) return null // 太大，肯定不是我们要找的那圈壁
          }
        }
      }
      return region
    }

    /**
     * 圆柱侧壁 → 圆。判据两条：这一整块光滑面的边界能拟合成圆，而且它自己的法线
     * 与圆心轴垂直（侧壁）；平躺的圆盘法线平行于轴，所以圆形台面不会被当成圆。
     * 返回 { center, normal, radius, points } 或 null。
     */
    function wallCircle(o, positions, normals, edgeMap) {
      var region = growSmooth(o, positions, normals, edgeMap)
      if (!region) return null
      var circles = regionCircles(region, positions)
      if (!circles.length) return null

      // 孔壁的边界上除了两端的圆，还常挂着别的小环：实测 Ø47 轴承座上有两个
      // Ø2.9 顶丝孔，边界因此多出两个 R1.45 的小圈。所以不要求"所有环一样大"，
      // 而是取半径最大的一组当圆，小环直接忽略。
      var best = null
      for (var i = 0; i < circles.length; i++) {
        var c = circles[i]
        if (c.radius > 0 && (!best || c.radius > best.radius)) best = c
      }
      if (!best) return null
      var pick = null
      for (var j = 0; j < circles.length; j++) {
        var d = circles[j]
        if (Math.abs(d.radius - best.radius) > best.radius * 0.02) continue // 小孔/别的圆
        if (Math.abs(dot3(d.normal, best.normal)) < 0.99) continue // 不在同一个轴上
        if (!pick || d.points.length > pick.points.length) pick = d
      }
      if (!pick) return null

      // 整块面必须真的贴在这个圆柱面上：法线要垂直于轴（侧壁而非盘面），
      // 顶点到轴的距离要处处相等（圆柱而非圆锥、球面）。
      var ax = pick.normal
      var cx = pick.center[0]
      var cy = pick.center[1]
      var cz = pick.center[2]
      var maxDot = 0
      var rMin = Infinity
      var rMax = 0
      for (var t = 0; t < region.length; t++) {
        var off = region[t]
        var dn = Math.abs(normals[off] * ax[0] + normals[off + 1] * ax[1] + normals[off + 2] * ax[2])
        if (dn > maxDot) maxDot = dn
        for (var k = 0; k < 3; k++) {
          var dx = positions[off + k * 3] - cx
          var dy = positions[off + k * 3 + 1] - cy
          var dz = positions[off + k * 3 + 2] - cz
          var along = dx * ax[0] + dy * ax[1] + dz * ax[2]
          dx -= ax[0] * along
          dy -= ax[1] * along
          dz -= ax[2] * along
          var r = Math.sqrt(dx * dx + dy * dy + dz * dz)
          if (r < rMin) rMin = r
          if (r > rMax) rMax = r
        }
      }
      if (maxDot > 0.35) return null // 法线顺着轴 → 这是个盘面，不是侧壁
      if (rMax - rMin > pick.radius * 0.02) return null // 半径沿线变化 → 圆锥/球面
      return pick
    }

    // ---- 量距离用的小工具（全是纯函数，方便单测） ----

    function sub3(a, b) {
      return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
    }

    function dot3(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    }

    function norm3(a) {
      var len = Math.sqrt(dot3(a, a)) || 1
      return [a[0] / len, a[1] / len, a[2] / len]
    }

    function vecDist(a, b) {
      var dx = a[0] - b[0]
      var dy = a[1] - b[1]
      var dz = a[2] - b[2]
      return Math.sqrt(dx * dx + dy * dy + dz * dz)
    }

    /** 线段 a-b 上离 p 最近的点（夹在两端点之间）。 */
    function closestPointOnSegment(p, a, b) {
      var ab = sub3(b, a)
      var den = dot3(ab, ab)
      var t = den > 1e-12 ? dot3(sub3(p, a), ab) / den : 0
      if (t < 0) t = 0
      if (t > 1) t = 1
      var q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]
      return { d: vecDist(p, q), p: q, t: t }
    }

    /** 点到平面：垂足、无符号距离、有符号距离（沿法线）。 */
    function pointPlane(p, plane) {
      var s = dot3(sub3(p, plane.c), plane.n)
      return {
        d: Math.abs(s),
        signed: s,
        foot: [p[0] - plane.n[0] * s, p[1] - plane.n[1] * s, p[2] - plane.n[2] * s]
      }
    }

    /** 两条线段的夹角，0-90°（不关心方向正负）。 */
    function segmentAngleDeg(a1, b1, a2, b2) {
      var d = Math.abs(dot3(norm3(sub3(b1, a1)), norm3(sub3(b2, a2))))
      if (d > 1) d = 1
      return (Math.acos(d) * 180) / Math.PI
    }

    /** 线段方向与平面法线的夹角，0-90°。 */
    function segmentNormalAngleDeg(a, b, n) {
      var d = Math.abs(dot3(norm3(sub3(b, a)), n))
      if (d > 1) d = 1
      return (Math.acos(d) * 180) / Math.PI
    }

    /** 屏幕坐标 (x, y) 到投影像段 sa-sb 的距离，用来做"靠近棱就吸附"。 */
    function segmentGap2D(x, y, sa, sb) {
      var dx = sb.x - sa.x
      var dy = sb.y - sa.y
      var den = dx * dx + dy * dy
      var t = den > 1e-9 ? ((x - sa.x) * dx + (y - sa.y) * dy) / den : 0
      if (t < 0) t = 0
      if (t > 1) t = 1
      var px = sa.x + dx * t - x
      var py = sa.y + dy * t - y
      return Math.sqrt(px * px + py * py)
    }

    // ==================================================================
    // 共面区域：STL 只有三角形，没有"面"的概念。用户说"两个面"时，指的是
    // 一整块连续共面的三角面（一块板、一个台阶面），所以选中的三角形会沿
    // 共享边扩散成整个平面区域。
    // ==================================================================

    var REGION_LIMIT = 20000 // 单个区域最多这么多三角形，防止在粗糙网格上一口气扩散到全模型
    var EDGE_MAP_LIMIT = 200000 // 再大就不建边表了（内存换速度）

    /** 顶点坐标 → 边表用的 key。浮点四舍五入到 1e-4，够吸收导出器的舍入误差。 */
    function vertexKey(positions, i) {
      return (
        Math.round(positions[i] * 1e4) + ',' +
        Math.round(positions[i + 1] * 1e4) + ',' +
        Math.round(positions[i + 2] * 1e4)
      )
    }

    /** 哪些三角形共用一条边：`边 key → [三角形字节偏移]`。 */
    function buildEdgeMap(positions) {
      var map = Object.create(null)
      var count = positions.length
      for (var o = 0; o < count; o += 9) {
        var k0 = vertexKey(positions, o)
        var k1 = vertexKey(positions, o + 3)
        var k2 = vertexKey(positions, o + 6)
        pushEdge(map, k0, k1, o)
        pushEdge(map, k1, k2, o)
        pushEdge(map, k2, k0, o)
      }
      return map
    }

    function pushEdge(map, a, b, o) {
      var k = a < b ? a + '|' + b : b + '|' + a
      var list = map[k]
      if (list) list.push(o)
      else map[k] = [o]
    }

    /**
     * 从 o 出发，沿共享边扩散出连续共面的三角形（法线夹角 < 0.6°、
     * 且都与起始平面同面）。返回字节偏移数组，含 o 自己。
     */
    function growRegion(o, positions, edgeMap, plane, radius) {
      var region = [o]
      if (!edgeMap) return region
      var seen = Object.create(null)
      seen[o] = 1
      var stack = [o]
      var tol = Math.max(1e-6, radius * 1e-4)
      while (stack.length && region.length < REGION_LIMIT) {
        var cur = stack.pop()
        var k0 = vertexKey(positions, cur)
        var k1 = vertexKey(positions, cur + 3)
        var k2 = vertexKey(positions, cur + 6)
        var keys = [k0 + '|' + k1, k1 + '|' + k2, k2 + '|' + k0]
        for (var e = 0; e < 3; e++) {
          var raw = keys[e].split('|')
          var k = raw[0] < raw[1] ? keys[e] : raw[1] + '|' + raw[0]
          var list = edgeMap[k]
          if (!list) continue
          for (var i = 0; i < list.length; i++) {
            var nb = list[i]
            if (seen[nb]) continue
            var np = facePlane(positions, nb)
            if (Math.abs(np.n[0] * plane.n[0] + np.n[1] * plane.n[1] + np.n[2] * plane.n[2]) < 0.99995) continue
            var dx = np.c[0] - plane.c[0]
            var dy = np.c[1] - plane.c[1]
            var dz = np.c[2] - plane.c[2]
            if (Math.abs(dx * plane.n[0] + dy * plane.n[1] + dz * plane.n[2]) > tol) continue
            seen[nb] = 1
            region.push(nb)
            stack.push(nb)
            if (region.length >= REGION_LIMIT) break
          }
        }
      }
      return region
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
      var picks = [] // 已选要素：{ kind: 'point'|'edge'|'face', ... }，渲染坐标
      var hover = null // 光标下会选中的那个要素，只用于高亮预览
      var edgeMap = null // 边 → 三角形，用来把选中的三角形扩散成整块共面区域
      var featureEdges = null // 边 key → true，折边与边界
      var corners = null // 顶点 key → true，落在特征棱上的角点
      var featureAdj = null // 顶点 key → 邻接顶点，用来把一个圆边界走成整圈
      var circleCache = null // 边 key → 圆（拟合不上存 null），避免每次悬停都重算
      var topoReady = false // 角点 / 折边是否已经建过（惰性）
      var measure = null // 两个要素之间的结果 { main, sub, delta, a, b, ... }
      var single = null // 只选了一个要素时的说明（目前只有圆：Ø / R）
      var labelEls = null // { box, dist, mode, delta }
      var panelEl = null // 左上角的结果面板
      var axisEl = null // 右下角的 XYZ 三脚标
      var axisParts = null // { lines: [], labels: [], ring }
      var showAxis = true
      var panelSig = '' // 面板上一次渲染的内容签名，避免每帧重建 DOM
      var measureListener = null // 测量状态变化时通知 React
      var lastHoverAt = 0

      // 显示模式与视角过渡
      var wire = false
      var wireBuffer = null
      var wireCount = 0
      var spin = false
      var tween = null
      var viewListener = null

      // 装配体运动：分解 + 逐个零件转动。变换直接烘进顶点（basePositions 是
      // finalizeMesh 之后的原样顶点），所以拾取、测量、线框都不用另算矩阵。
      var motionMode = false
      var explode = 0 // 0 合拢，1 全散开
      var explodeFrom = 0
      var explodeTo = 0
      var explodeStart = 0
      var explodeDuration = 900
      var explodePlaying = false
      var selectedPart = -1
      var motionListener = null
      var coupled = true // 齿轮联动：改一个零件的转速，齿链上的一起转
      var gears = null // describeGears() 的结果：{ parts, pairs }
      var basePositions = null // 与 mesh.positions 同长的原始顶点
      var baseNormals = null // 原始法线，转正后用同样的旋转带回
      var lastMotionAt = 0

      var cssWidth = 1
      var cssHeight = 1
      var pixelRatio = 1

      var rafId = 0
      var attached = false
      var drawQueued = false

      var cam = {
        yaw: 0.85,
        pitch: 0.42,
        q: [0, 0, 0, 1],
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
            preserveDrawingBuffer: true,
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
        measure = null
        single = null
        edgeMap = null
        featureEdges = null
        corners = null
        featureAdj = null
        circleCache = null
        topoReady = false
        // 换模型就把运动状态清干净：分解回 0，零件不再自转
        basePositions = null
        baseNormals = null
        explode = 0
        explodePlaying = false
        selectedPart = -1
        if (mesh && mesh.parts) {
          for (var mp = 0; mp < mesh.parts.length; mp++) {
            mesh.parts[mp].angle = 0
            mesh.parts[mp].speed = 0
            mesh.parts[mp].moved = false
          }
        }
        notifyMotion()
        if (!mesh) {
          updateLabel()
          invalidate()
          return
        }
        basePositions = mesh.positions.slice()
        baseNormals = mesh.normals.slice()
        gears = describeGears(mesh.positions, mesh.parts)
        // 零件清单与啮合对要一起回到面板，否则第一次打开「运动」看不到传动比
        notifyMotion()
        if (mesh.positions.length / 9 <= EDGE_MAP_LIMIT) {
          edgeMap = buildEdgeMap(mesh.positions)
        }
        if (!gl) return
        wireCount = 0
        uploadMesh()
        if (wire) buildWire()
        updateLabel()
        invalidate()
      }

      /**
       * 角点 / 折边是测量才需要的东西，47k 面的模型建一次约 0.6 s，
       * 所以推迟到第一次真正要拾取时再算，打开文件时不会卡一下。
       */
      // ---------------- 装配体运动 ----------------
      // 分解视图：每个零件沿"整机重心 → 自己重心"的方向推开；
      // 单个零件：绕自己的轴（默认是最扁的那根模型轴）转。
      // 变换直接写进顶点缓冲，所以拾取、测量、线框看到的永远是当前位置。

      /** 面板要的零件清单：既回灌给 React，也给测试读。 */
      function partSummaries() {
        var list = []
        if (mesh && mesh.parts) {
          for (var i = 0; i < mesh.parts.length; i++) {
            var p = mesh.parts[i]
            list.push({
              index: i,
              name: p.name || '',
              spinning: Math.abs(p.speed) > 1e-6,
              speed: p.speed,
              axis: p.axis,
              radius: p.radius,
              teeth: p.teeth || 0,
              selected: i === selectedPart
            })
          }
        }
        return list
      }

      function notifyMotion() {
        if (typeof motionListener !== 'function') return
        try {
          // 直接回灌完整状态：面板还要 coupled 与啮合对，少一项就整行不渲染
          motionListener(motionState())
        } catch (e) {}
      }

      /** 零件的回转轴（渲染空间向量）。axis < 0 表示自动：用最扁的那根模型轴。 */
      function partAxis(part) {
        var a = part.axis >= 0 && part.axis < 3 ? part.axis : part.flat
        return MODEL_AXES[a >= 0 && a < 3 ? a : 0]
      }

      /** 分解方向：从整机重心（原点）指向零件自己的重心。 */
      function partDirection(part) {
        var c = part.center
        var len = Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2])
        if (len < 1e-6) return [0, 1, 0]
        return [c[0] / len, c[1] / len, c[2] / len]
      }

      /** 按"当前分解量 + 当前转角"重算这个零件的顶点与法线。 */
      function applyPart(part) {
        if (!basePositions || !baseNormals || !mesh) return
        var pos = mesh.positions
        var nrm = mesh.normals
        var dir = partDirection(part)
        // 推开量按零件自己的尺寸给：大件多推、小件少推，整机不会被撑爆
        var amount = explode * (part.radius * 0.9 + 0.12)
        var ox = dir[0] * amount
        var oy = dir[1] * amount
        var oz = dir[2] * amount
        var axis = partAxis(part)
        var angle = part.angle || 0
        var ca = Math.cos(angle)
        var sa = Math.sin(angle)
        var ax = axis[0], ay = axis[1], az = axis[2]
        var one = 1 - ca
        var cx = part.center[0], cy = part.center[1], cz = part.center[2]
        var start = part.start * 9
        var end = (part.start + part.count) * 9
        for (var o = start; o < end; o += 3) {
          var px = basePositions[o] - cx
          var py = basePositions[o + 1] - cy
          var pz = basePositions[o + 2] - cz
          var nx = baseNormals[o]
          var ny = baseNormals[o + 1]
          var nz = baseNormals[o + 2]
          if (angle !== 0) {
            // 罗德里格公式：位置绕零件自己的轴转，法线跟着转（否则打光停在旧朝向）
            var dot = px * ax + py * ay + pz * az
            var crx = ay * pz - az * py
            var cry = az * px - ax * pz
            var crz = ax * py - ay * px
            px = px * ca + crx * sa + ax * dot * one
            py = py * ca + cry * sa + ay * dot * one
            pz = pz * ca + crz * sa + az * dot * one
            var nd = nx * ax + ny * ay + nz * az
            var ncx = ay * nz - az * ny
            var ncy = az * nx - ax * nz
            var ncz = ax * ny - ay * nx
            nx = nx * ca + ncx * sa + ax * nd * one
            ny = ny * ca + ncy * sa + ay * nd * one
            nz = nz * ca + ncz * sa + az * nd * one
          }
          pos[o] = px + cx + ox
          pos[o + 1] = py + cy + oy
          pos[o + 2] = pz + cz + oz
          nrm[o] = nx
          nrm[o + 1] = ny
          nrm[o + 2] = nz
        }
      }

      function uploadPart(part) {
        if (!gl || !mesh) return
        var from = part.start * 9
        var to = (part.start + part.count) * 9
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, from * 4, mesh.positions.subarray(from, to))
        gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, from * 4, mesh.normals.subarray(from, to))
      }

      function restorePart(part) {
        if (!gl || !mesh || !basePositions || !baseNormals) return
        var from = part.start * 9
        var to = (part.start + part.count) * 9
        mesh.positions.set(basePositions.subarray(from, to), from)
        mesh.normals.set(baseNormals.subarray(from, to), from)
        uploadPart(part)
      }

      /** 当前运动状态是否让这个零件离开了原位。 */
      function partIsMoved(part) {
        return explode > 1e-6 || Math.abs(part.angle) > 1e-9
      }

      /** 把所有零件重新写一遍（分解滑块、换轴、停转时用）。 */
      function applyAllParts() {
        if (!mesh || !mesh.parts || !basePositions) return
        for (var i = 0; i < mesh.parts.length; i++) {
          var p = mesh.parts[i]
          var moved = partIsMoved(p)
          if (!moved && !p.moved) continue
          if (moved) {
            applyPart(p)
            uploadPart(p)
          } else {
            restorePart(p)
          }
          p.moved = moved
        }
        if (wire) buildWire()
        invalidate()
      }

      /**
       * 每帧推进：分解动画 + 各零件自转。返回 false 表示这一帧什么都不用做。
       */
      function advanceMotion(at) {
        if (!mesh || !mesh.parts || !basePositions || !baseNormals) return false
        var t = typeof at === 'number' && at > 0 ? at : now()
        var dt = lastMotionAt ? Math.min(0.12, Math.max(0, (t - lastMotionAt) / 1000)) : 0
        lastMotionAt = t
        var changed = false

        if (explodePlaying) {
          var k = explodeDuration > 0 ? clamp((t - explodeStart) / explodeDuration, 0, 1) : 1
          var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
          explode = explodeFrom + (explodeTo - explodeFrom) * e
          changed = true
          // 镜头跟着分解量退，零件不会跑出画面
          cam.dist = clamp((cam.fit || 5) * (1 + explode * 0.95), cam.min, cam.max)
          if (k >= 1) {
            explode = explodeTo
            explodePlaying = false
            notifyMotion()
          }
        }

        for (var i = 0; i < mesh.parts.length; i++) {
          var p = mesh.parts[i]
          if (Math.abs(p.speed) <= 1e-6) continue
          if (dt > 0) {
            p.angle += p.speed * Math.PI * 2 * dt
            changed = true
          }
        }

        if (!changed) return false
        applyAllParts()
        return true
      }

      /** 分解滑块：0 合拢，1 全散开；animate=true 走 900 ms 缓动。
       *  散开时把镜头一起拉远，否则零件会被推到视野外面。 */
      function setExplode(value, animate) {
        var next = clamp(Number(value) || 0, 0, 1)
        // 只有一个零件时分解没有意义（整块会飘走），直接按 0 处理
        if (mesh && mesh.parts && mesh.parts.length < 2) next = 0
        var want = (cam.fit || 5) * (1 + next * 0.95)
        cam.dist = clamp(want, cam.min, cam.max)
        if (animate) {
          explodeFrom = explode
          explodeTo = next
          explodeStart = now()
          explodeDuration = 900
          explodePlaying = true
          lastMotionAt = 0
          invalidate()
        } else {
          explode = next
          explodePlaying = false
          applyAllParts()
        }
        notifyMotion()
        invalidate()
      }

      /** 播放 / 暂停分解：往当前状态的反方向走。 */
      function playExplode(on) {
        var want = on === undefined ? !explodePlaying : !!on
        if (!want) {
          explodePlaying = false
          notifyMotion()
          invalidate()
          return
        }
        setExplode(explode > 0.5 ? 0 : 1, true)
      }

      function partAt(index) {
        if (!mesh || !mesh.parts) return null
        return mesh.parts[index] || null
      }

      /**
       * 齿轮联动：从 index 出发沿啮合图走一圈，邻居的转速按分度半径反比给，
       * 方向相反（外啮合）。三相啮合链（大轮 - 小齿 - 大轮）也自然成立：
       * 两个大轮同向、小齿反向。
       */
      /** 一对啮合件的传动比（从 fromIndex 看对方）：同模数时就是齿数反比。 */
      function pairRatio(pair, fromIndex) {
        var A = partAt(pair.a)
        var B = partAt(pair.b)
        var ratio = pair.ratio
        if (A && B && A.teeth > 0 && B.teeth > 0) ratio = A.teeth / B.teeth
        return pair.a === fromIndex ? ratio : 1 / ratio
      }

      function coupleFrom(index) {
        if (!gears || !gears.pairs.length) return
        var seen = {}
        var queue = [index]
        seen[index] = true
        while (queue.length) {
          var i = queue.shift()
          var src = partAt(i)
          if (!src) continue
          for (var k = 0; k < gears.pairs.length; k++) {
            var pair = gears.pairs[k]
            var other = pair.a === i ? pair.b : pair.b === i ? pair.a : -1
            if (other < 0 || seen[other]) continue
            var dst = partAt(other)
            if (!dst) continue
            var ratio = pairRatio(pair, i)
            dst.speed = -src.speed * ratio
            seen[other] = true
            queue.push(other)
          }
        }
      }

      function setPartSpin(index, speed) {
        var p = partAt(index)
        if (!p) return
        p.speed = Number(speed) || 0
        if (coupled) coupleFrom(index)
        lastMotionAt = 0
        applyAllParts()
        notifyMotion()
        invalidate()
      }

      /** 开 / 关联动；打开时按当前选中的零件重新分配一遍转速。 */
      function setCoupled(on) {
        coupled = !!on
        if (coupled && mesh && mesh.parts && mesh.parts.length) {
          var driver = selectedPart >= 0 && selectedPart < mesh.parts.length ? selectedPart : 0
          // 用整条链里已有的最大转速当驱动，避免打开后一片静止
          var best = -1
          var speed = 0
          for (var i = 0; i < mesh.parts.length; i++) {
            var s = mesh.parts[i].speed
            if (Math.abs(s) > Math.abs(speed)) {
              speed = s
              best = i
            }
          }
          if (best >= 0) driver = best
          coupleFrom(driver)
          if (Math.abs(speed) > 1e-6 && Math.abs(partAt(driver).speed) < 1e-6) {
            partAt(driver).speed = speed
            coupleFrom(driver)
          }
        }
        applyAllParts()
        notifyMotion()
        invalidate()
      }

      /** 设置齿数：只影响联动比例，0 表示回到几何估计。 */
      function setPartTeeth(index, teeth) {
        var p = partAt(index)
        if (!p) return
        var z = Math.round(Number(teeth) || 0)
        p.teeth = z > 0 ? z : 0
        if (coupled) {
          var driver = selectedPart >= 0 && selectedPart < (mesh.parts || []).length ? selectedPart : index
          coupleFrom(driver)
        }
        notifyMotion()
        invalidate()
      }

      function setPartAxis(index, axis) {
        var p = partAt(index)
        if (!p) return
        p.axis = axis === -1 || axis === 0 || axis === 1 || axis === 2 ? axis : -1
        applyAllParts()
        notifyMotion()
        invalidate()
      }

      function selectPart(index) {
        selectedPart = typeof index === 'number' ? index : -1
        notifyMotion()
        invalidate()
      }

      /** 某个三角形属于哪个零件（拾取时用）。 */
      function partAtOffset(offset) {
        if (!mesh || !mesh.parts) return -1
        var tri = offset / 9
        for (var i = 0; i < mesh.parts.length; i++) {
          var p = mesh.parts[i]
          if (tri >= p.start && tri < p.start + p.count) return i
        }
        return -1
      }

      /** 在模型上点一下选中零件；没点到就取消选择。 */
      function pickPart(clientX, clientY) {
        var hit = raycast(clientX, clientY)
        var index = hit ? partAtOffset(hit.o) : -1
        selectPart(index)
        return index
      }

      /** 有零件在自转吗？决定要不要继续请求下一帧。 */
      function motionSpinning() {
        if (!mesh || !mesh.parts) return false
        for (var i = 0; i < mesh.parts.length; i++) {
          if (Math.abs(mesh.parts[i].speed) > 1e-6) return true
        }
        return false
      }

      function resetMotion() {
        explode = 0
        explodePlaying = false
        selectedPart = -1
        if (mesh && mesh.parts) {
          for (var i = 0; i < mesh.parts.length; i++) {
            mesh.parts[i].speed = 0
            mesh.parts[i].angle = 0
          }
        }
        // 啮合关系只跟零件本身的几何有关：用未变形的顶点重算，别拿转过的缓冲
        if (mesh && mesh.parts) gears = describeGears(basePositions || mesh.positions, mesh.parts)
        lastMotionAt = 0
        applyAllParts()
        notifyMotion()
      }

      function motionState() {
        return {
          on: motionMode,
          explode: explode,
          playing: explodePlaying,
          selected: selectedPart,
          coupled: coupled,
          count: mesh && mesh.parts ? mesh.parts.length : 0,
          gears: gears
            ? {
              pairs: gears.pairs.map(function (pair) {
                var A = partAt(pair.a)
                var B = partAt(pair.b)
                var ratio = pair.ratio
                if (A && B && A.teeth > 0 && B.teeth > 0) ratio = A.teeth / B.teeth
                return { a: pair.a, b: pair.b, ratio: ratio }
              })
            }
            : { pairs: [] },
          parts: partSummaries()
        }
      }

      /** 运动改变了几何：折边 / 角点 / 圆 / 边表都要按新位置重建。 */
      function invalidateTopology() {
        topoReady = false
        featureEdges = null
        corners = null
        featureAdj = null
        circleCache = null
        if (!mesh) {
          edgeMap = null
          return
        }
        edgeMap = mesh.positions.length / 9 <= EDGE_MAP_LIMIT ? buildEdgeMap(mesh.positions) : null
      }

      function setMotionMode(on) {
        motionMode = !!on
        if (motionMode) {
          if (measureMode) setMeasureMode(false)
        } else {
          resetMotion()
          selectedPart = -1
        }
        notifyMotion()
        invalidate()
      }

      function onMotionChange(fn) {
        motionListener = typeof fn === 'function' ? fn : null
        return function () { if (motionListener === fn) motionListener = null }
      }

      function ensureTopology() {
        if (topoReady || !mesh) return
        topoReady = true
        circleCache = Object.create(null)
        if (mesh.positions.length / 3 > TOPOLOGY_LIMIT) return
        var topo = buildFeatureTopology(mesh.positions, mesh.normals)
        featureEdges = topo.edges
        corners = topo.corners
        featureAdj = topo.adj
      }

      /**
       * 光标下那条棱所在的圆。第一次算出来之后把整圈棱都缓存上，
       * 这样再沿同一个圆移动光标不会重新走环。
       */
      function circleForEdge(pos, i0, i1) {
        if (!featureAdj || !circleCache) return null
        var key = edgeKeyOf(pos, i0, i1)
        var cached = circleCache[key]
        if (cached !== undefined) return cached
        var circle = circleFromEdge(pos, featureAdj, i0, i1)
        if (circle) {
          for (var k = 0; k < circle.edgeKeys.length; k++) circleCache[circle.edgeKeys[k]] = circle
        }
        circleCache[key] = circle
        return circle
      }

      // ---------------- 测量 ----------------
      // 参考 Bambu Studio：光标靠近模型的角点就吸成"点"，靠近特征棱就吸成"边"，
      // 否则选整块共面区域。两个要素的组合决定量什么：点-点 / 点-边 / 点-面 /
      // 边-边 / 边-面 / 面-面；带角度的组合同时给夹角。

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

      /** 屏幕射线与网格求交：最近的三角面 + 命中点。 */
      function raycast(clientX, clientY) {
        if (!mesh || !vertexCount) return null
        var rect = canvas.getBoundingClientRect()
        var ray = screenRay(cam, FOV, cssWidth, cssHeight, clientX, clientY, rect)
        var pos = mesh.positions
        var bestT = 0
        var bestO = -1
        for (var o = 0; o < pos.length; o += 9) {
          var hit = rayTriangle(
            ray.origin[0], ray.origin[1], ray.origin[2],
            ray.dir[0], ray.dir[1], ray.dir[2],
            pos, o
          )
          if (hit > 0 && (bestO < 0 || hit < bestT)) {
            bestT = hit
            bestO = o
          }
        }
        if (bestO < 0) return null
        return {
          o: bestO,
          point: [
            ray.origin[0] + ray.dir[0] * bestT,
            ray.origin[1] + ray.dir[1] * bestT,
            ray.origin[2] + ray.dir[2] * bestT
          ]
        }
      }

      /** 命中的三角面（字节偏移），没命中返回 -1。 */
      function pickFace(clientX, clientY) {
        var hit = raycast(clientX, clientY)
        return hit ? hit.o : -1
      }

      /** 屏幕坐标到空间点的距离（点不可见时返回 Infinity）。 */
      function screenGap(x, y, p) {
        var sp = project(p)
        if (!sp) return Infinity
        var dx = sp.x - x
        var dy = sp.y - y
        return Math.sqrt(dx * dx + dy * dy)
      }

      function isFeatureEdge(pos, i0, i1) {
        return !!(featureEdges && featureEdges[edgeKeyOf(pos, i0, i1)])
      }

      function cornerAt(pos, i) {
        return !!(corners && corners[coordKey(pos[i], pos[i + 1], pos[i + 2])])
      }

      /**
       * 光标下如果压着某个圆的边，就选中整个圆。
       * 圆形孔的边界是一圈很短的折边，按"棱"或者"角点"去选永远只能选到一小段，
       * 所以圆的判定排在角点前面：想量内径 / 外径，点一下边界就够了。
       */
      function pickCircle(clientX, clientY, pos, o) {
        if (!featureAdj) return null
        var best = null
        var bestGap = SNAP_CIRCLE
        for (var e = 0; e < 3; e++) {
          var i0 = o + EDGE_TRIS[e][0] * 3
          var i1 = o + EDGE_TRIS[e][1] * 3
          if (!isFeatureEdge(pos, i0, i1)) continue
          var sa = project([pos[i0], pos[i0 + 1], pos[i0 + 2]])
          var sb = project([pos[i1], pos[i1 + 1], pos[i1 + 2]])
          if (!sa || !sb) continue
          var gap = segmentGap2D(clientX, clientY, sa, sb)
          if (gap >= bestGap) continue
          var circle = circleForEdge(pos, i0, i1)
          if (!circle) continue
          bestGap = gap
          best = circle
        }
        if (!best) return null
        return {
          kind: 'circle',
          center: best.center,
          radius: best.radius,
          normal: best.normal,
          loop: best.points
        }
      }

      /** 光标下的要素：圆 → 角点 → 特征棱 → 平面。free=true 取任意表面点，不吸附。 */
      function pickFeature(clientX, clientY, free) {
        var hit = raycast(clientX, clientY)
        if (!hit) return null
        if (free) return { kind: 'point', p: hit.point, free: true }
        ensureTopology()
        var pos = mesh.positions
        var circle = pickCircle(clientX, clientY, pos, hit.o)
        if (circle) return circle
        if (featureEdges && corners) {
          var i, p, d
          var bestV = -1
          var bestVD = SNAP_VERTEX
          for (i = 0; i < 9; i += 3) {
            if (!cornerAt(pos, hit.o + i)) continue
            p = [pos[hit.o + i], pos[hit.o + i + 1], pos[hit.o + i + 2]]
            d = screenGap(clientX, clientY, p)
            if (d < bestVD) { bestVD = d; bestV = i }
          }
          if (bestV >= 0) {
            return {
              kind: 'point',
              p: [pos[hit.o + bestV], pos[hit.o + bestV + 1], pos[hit.o + bestV + 2]]
            }
          }
          var e, i0, i1, sa, sb, ed
          var bestE = -1
          var bestED = SNAP_EDGE
          for (e = 0; e < 3; e++) {
            i0 = hit.o + EDGE_TRIS[e][0] * 3
            i1 = hit.o + EDGE_TRIS[e][1] * 3
            if (!isFeatureEdge(pos, i0, i1)) continue
            sa = project([pos[i0], pos[i0 + 1], pos[i0 + 2]])
            sb = project([pos[i1], pos[i1 + 1], pos[i1 + 2]])
            if (!sa || !sb) continue
            ed = segmentGap2D(clientX, clientY, sa, sb)
            if (ed < bestED) { bestED = ed; bestE = e }
          }
          if (bestE >= 0) {
            i0 = hit.o + EDGE_TRIS[bestE][0] * 3
            i1 = hit.o + EDGE_TRIS[bestE][1] * 3
            return {
              kind: 'edge',
              a: [pos[i0], pos[i0 + 1], pos[i0 + 2]],
              b: [pos[i1], pos[i1 + 1], pos[i1 + 2]]
            }
          }
        }
        // 直径测量最常见的动作是往孔里点一下：命中点是孔的侧壁，整块侧壁就是一个圆
        var wall = wallCircle(hit.o, pos, mesh.normals, edgeMap)
        if (wall) {
          return {
            kind: 'circle',
            center: wall.center,
            radius: wall.radius,
            normal: wall.normal,
            loop: wall.points
          }
        }
        var plane = facePlane(pos, hit.o)
        return {
          kind: 'face',
          o: hit.o,
          plane: plane,
          region: growRegion(hit.o, pos, edgeMap, plane, mesh.radius || 1)
        }
      }

      function featureKey(f) {
        if (!f) return ''
        if (f.kind === 'point') return 'p' + coordKey(f.p[0], f.p[1], f.p[2])
        if (f.kind === 'edge') {
          return 'e' + coordKey(f.a[0], f.a[1], f.a[2]) + '~' + coordKey(f.b[0], f.b[1], f.b[2])
        }
        if (f.kind === 'circle') {
          return 'c' + coordKey(f.center[0], f.center[1], f.center[2]) + '#' + Math.round(f.radius * 1e4)
        }
        return 'f' + f.o
      }

      /** 同一块平面上的另一个三角形不算"新选的面"。 */
      function sameFeature(a, b) {
        if (!a || !b) return false
        if (a.kind === 'face' && b.kind === 'face') {
          return a.region.indexOf(b.o) >= 0 || b.region.indexOf(a.o) >= 0
        }
        return featureKey(a) === featureKey(b)
      }

      // ---- 两两组合 ----

      function pairPointPoint(A, B) {
        return {
          dist: vecDist(A.p, B.p),
          a: A.p,
          b: B.p,
          type: t('ptToPt'),
          mainLabel: t('distance'),
          sub: t('ptToPt')
        }
      }

      function pairPointFace(A, B) {
        var r = pointPlane(A.p, B.plane)
        return {
          dist: r.d,
          a: A.p,
          b: r.foot,
          type: t('ptToFace'),
          mainLabel: t('distance'),
          sub: t('ptToFace')
        }
      }

      function pairPointEdge(A, B) {
        var r = closestPointOnSegment(A.p, B.a, B.b)
        return {
          dist: r.d,
          a: A.p,
          b: r.p,
          type: t('ptToEdge'),
          mainLabel: t('distance'),
          sub: t('ptToEdge')
        }
      }

      function pairEdgeEdge(A, B) {
        var r = closestSegments(A.a, A.b, B.a, B.b)
        return {
          dist: r.d,
          angleDeg: segmentAngleDeg(A.a, A.b, B.a, B.b),
          a: r.a,
          b: r.b,
          type: t('edgeToEdge'),
          mainLabel: t('distance'),
          sub: t('edgeToEdge')
        }
      }

      function pairEdgeFace(A, B) {
        var pl = B.plane
        var s1 = pointPlane(A.a, pl)
        var s2 = pointPlane(A.b, pl)
        var near = s1.d <= s2.d ? s1 : s2
        var p = s1.d <= s2.d ? A.a : A.b
        return {
          dist: near.d,
          angleDeg: 90 - segmentNormalAngleDeg(A.a, A.b, pl.n),
          a: p,
          b: near.foot,
          type: t('edgeToFace'),
          mainLabel: t('distance'),
          sub: t('edgeToFace')
        }
      }

      /**
       * 面到面：平行（夹角 < 2.6°）→ 平面间距，取两条法线方向的投影距离，
       * 这是工程上说的"厚度 / 对面间隙"，和两个三角面在不在正上方无关；
       * 不平行 → 夹角 + 两块区域之间的真实最短距离。
       */
      function pairFaceFace(A, B) {
        var pa = A.plane
        var pb = B.plane
        var dot = Math.abs(dot3(pa.n, pb.n))
        if (dot > 1) dot = 1
        var angleDeg = (Math.acos(dot) * 180) / Math.PI
        if (dot > 0.999) {
          var gap = dot3(sub3(pb.c, pa.c), pa.n)
          var foot = [pa.c[0] + pa.n[0] * gap, pa.c[1] + pa.n[1] * gap, pa.c[2] + pa.n[2] * gap]
          return {
            dist: Math.abs(gap),
            a: pa.c,
            b: foot,
            parallel: true,
            angleDeg: angleDeg,
            type: t('faceToFace'),
            mainLabel: t('parallelFaces'),
            sub: t('faceToFace') + ' · ' + t('parallelFaces')
          }
        }
        var t2 = regionDistance(mesh.positions, A.region, B.region)
        return {
          dist: t2.d,
          a: t2.a,
          b: t2.b,
          parallel: false,
          angleDeg: angleDeg,
          type: t('faceToFace'),
          mainLabel: t('spacing'),
          sub: t('faceToFace') + ' · ' + t('angleFaces')
        }
      }

      // 量到圆的时候 Bambu 一律给"圆心到对方"，直径 / 半径另起一行显示。
      function pairCircleCircle(A, B) {
        return {
          dist: vecDist(A.center, B.center),
          a: A.center,
          b: B.center,
          type: t('circleToCircle'),
          mainLabel: t('centerDist'),
          sub: t('circleToCircle') + ' · ' + t('centerDist')
        }
      }

      function pairCirclePoint(A, B) {
        return {
          dist: vecDist(A.center, B.p),
          a: A.center,
          b: B.p,
          type: t('circleToPoint'),
          mainLabel: t('distance'),
          sub: t('circleToPoint')
        }
      }

      function pairCircleEdge(A, B) {
        var r = closestPointOnSegment(A.center, B.a, B.b)
        return {
          dist: r.d,
          a: A.center,
          b: r.p,
          type: t('circleToEdge'),
          mainLabel: t('distance'),
          sub: t('circleToEdge')
        }
      }

      function pairCircleFace(A, B) {
        var r = pointPlane(A.center, B.plane)
        return {
          dist: r.d,
          a: A.center,
          b: r.foot,
          type: t('circleToFace'),
          mainLabel: t('distance'),
          sub: t('circleToFace')
        }
      }

      function pairMeasure(A, B) {
        var ka = A.kind
        var kb = B.kind
        if (ka === 'face' && kb === 'face') return pairFaceFace(A, B)
        if (ka === 'point' && kb === 'point') return pairPointPoint(A, B)
        if (ka === 'point' && kb === 'face') return pairPointFace(A, B)
        if (ka === 'face' && kb === 'point') return pairPointFace(B, A)
        if (ka === 'point' && kb === 'edge') return pairPointEdge(A, B)
        if (ka === 'edge' && kb === 'point') return pairPointEdge(B, A)
        if (ka === 'edge' && kb === 'edge') return pairEdgeEdge(A, B)
        if (ka === 'edge' && kb === 'face') return pairEdgeFace(A, B)
        if (ka === 'face' && kb === 'edge') return pairEdgeFace(B, A)
        if (ka === 'circle' && kb === 'circle') return pairCircleCircle(A, B)
        if (ka === 'circle' && kb === 'point') return pairCirclePoint(A, B)
        if (ka === 'point' && kb === 'circle') return pairCirclePoint(B, A)
        if (ka === 'circle' && kb === 'edge') return pairCircleEdge(A, B)
        if (ka === 'edge' && kb === 'circle') return pairCircleEdge(B, A)
        if (ka === 'circle' && kb === 'face') return pairCircleFace(A, B)
        if (ka === 'face' && kb === 'circle') return pairCircleFace(B, A)
        return null
      }

      function computeMeasure() {
        if (picks.length !== 2 || !mesh) return null
        var r = pairMeasure(picks[0], picks[1])
        if (!r) return null
        var inv = 1 / (mesh.scale || 1)
        var a = toModel(r.a)
        var b = toModel(r.b)
        var unit = t('unit')
        var rows = []
        var main
        var sub = r.sub
        if (r.angleDeg != null && r.angleDeg >= 0.05) {
          main = r.angleDeg.toFixed(1) + '°'
          rows.push({ label: t('angleFaces'), value: r.angleDeg.toFixed(1) + '°' })
          if (r.dist != null) sub += ' · ' + t('spacing') + ' ' + fmtDim(r.dist * inv) + ' ' + unit
        } else {
          main = fmtDim(r.dist * inv) + ' ' + unit
        }
        if (r.dist != null) {
          rows.push({ label: r.mainLabel || t('distance'), value: fmtDim(r.dist * inv) + ' ' + unit })
        }
        // 参与测量的圆把自己的 Ø / R 也列出来，量内径外径时一眼能核对
        var twoCircles = picks[0].kind === 'circle' && picks[1].kind === 'circle'
        for (var c = 0; c < picks.length; c++) {
          var cf = picks[c]
          if (cf.kind !== 'circle') continue
          rows.push({
            label: t('diameter') + ' / ' + t('radius') + (twoCircles ? ' ' + (c + 1) : ''),
            value: 'Ø ' + fmtDim(cf.radius * 2 * inv) + ' · R ' + fmtDim(cf.radius * inv)
          })
        }
        rows.push({ label: 'ΔX', value: fmtDim(Math.abs(b[0] - a[0])) + ' ' + unit })
        rows.push({ label: 'ΔY', value: fmtDim(Math.abs(b[1] - a[1])) + ' ' + unit })
        rows.push({ label: 'ΔZ', value: fmtDim(Math.abs(b[2] - a[2])) + ' ' + unit })
        return {
          title: r.type || t('measure'),
          rows: rows,
          main: main,
          sub: sub,
          delta: 'ΔX ' + fmtDim(Math.abs(b[0] - a[0])) +
            '  ΔY ' + fmtDim(Math.abs(b[1] - a[1])) +
            '  ΔZ ' + fmtDim(Math.abs(b[2] - a[2])),
          a: r.a,
          b: r.b,
          dist: r.dist != null ? r.dist * inv : null,
          angleDeg: r.angleDeg == null ? null : r.angleDeg,
          parallel: r.parallel === true,
          kinds: [picks[0].kind, picks[1].kind]
        }
      }

      /**
       * 两块共面区域之间的最短距离。区域可能有上万个三角形，所以按乘积开方
       * 采样（每 k 个取一个），够精确到视觉上量的尺度，又不会卡住交互。
       */
      function regionDistance(positions, ra, rb) {
        var pairs = ra.length * rb.length
        var stepA = pairs > 4000 ? Math.max(1, Math.floor(Math.sqrt(pairs / 4000))) : 1
        var stepB = stepA
        var best = null
        for (var i = 0; i < ra.length; i += stepA) {
          for (var j = 0; j < rb.length; j += stepB) {
            var t2 = triTriDistance(positions, ra[i], rb[j])
            if (!best || t2.d < best.d) best = t2
          }
        }
        return best || { d: 0, a: [0, 0, 0], b: [0, 0, 0] }
      }

      /**
       * 悬停预览：高亮"点下去会选中的那个要素"，这样点之前就知道选到的是
       * 角点、棱还是整块平面。射线求交是线性的，47k 面一次约 2 ms，按时间节流。
       */
      function updateHover(clientX, clientY) {
        if (!mesh || !measureMode || picks.length >= 2) {
          if (hover) {
            hover = null
            invalidate()
          }
          return
        }
        var now = Date.now()
        if (now - lastHoverAt < 20) return
        lastHoverAt = now
        var next = pickFeature(clientX, clientY, false)
        if (featureKey(next) === featureKey(hover)) return
        hover = next
        invalidate()
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

      /**
       * 数值标签是普通 DOM，跟着相机走（每帧只改 left/top/textContent，不惊动 React）。
       * 选满两个要素就显示它们之间的关系；只选了一个圆时显示这个圆的 Ø / R。
       */
      function updateLabel() {
        updatePanel()
        if (!labelEls || !labelEls.box) return
        var box = labelEls.box
        var m = measure || single
        if (!m) {
          box.style.display = 'none'
          return
        }
        var sa = project(m.a)
        var sb = project(m.b)
        if (!sa || !sb) {
          box.style.display = 'none'
          return
        }
        // 标签放在线段中点的"上方一侧"，而不是正中：否则它会压住两个端点
        var mx = (sa.x + sb.x) / 2
        var my = (sa.y + sb.y) / 2
        var sx = sb.x - sa.x
        var sy = sb.y - sa.y
        var slen = Math.sqrt(sx * sx + sy * sy)
        var ox = 0
        var oy = -22
        if (slen > 6) {
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
        if (labelEls.dist) labelEls.dist.textContent = m.main
        if (labelEls.mode) labelEls.mode.textContent = m.sub
        if (labelEls.delta) labelEls.delta.textContent = m.delta || ''
      }

      /** 左上角面板：和 Bambu Studio 一样，选中圆时把 Ø 与 R 直接摆在左上角。 */
      function updatePanel() {
        if (!panelEl) return
        var m = measure || single
        if (!m || !m.rows || !m.rows.length) {
          if (panelEl.style.display !== 'none') {
            panelEl.style.display = 'none'
            panelSig = ''
          }
          return
        }
        var sig = (m.title || '') + '|' + m.main + '|' + m.sub
        for (var s = 0; s < m.rows.length; s++) sig += '|' + m.rows[s].label + '=' + m.rows[s].value
        if (sig === panelSig) {
          if (panelEl.style.display !== 'block') panelEl.style.display = 'block'
          return
        }
        panelSig = sig
        if (typeof document === 'undefined') return
        panelEl.textContent = ''
        var head = document.createElement('div')
        head.style.cssText = PANEL_TITLE_STYLE
        head.textContent = m.title || ''
        panelEl.appendChild(head)
        for (var i = 0; i < m.rows.length; i++) {
          var row = document.createElement('div')
          row.style.cssText = PANEL_ROW_STYLE
          var lab = document.createElement('span')
          lab.style.cssText = PANEL_LABEL_STYLE
          lab.textContent = m.rows[i].label
          var val = document.createElement('span')
          val.style.cssText = PANEL_VALUE_STYLE
          val.textContent = m.rows[i].value
          row.appendChild(lab)
          row.appendChild(val)
          panelEl.appendChild(row)
        }
        panelEl.style.display = 'block'
      }

      function setPanelEl(el) {
        panelEl = el || null
        panelSig = ''
        updatePanel()
      }

      /** 只选了一个圆：左上角直接给 Ø 和 R，这是量内径 / 外径最常用的读数。 */
      function singleOf(f) {
        if (!f || f.kind !== 'circle' || !mesh) return null
        var inv = 1 / (mesh.scale || 1)
        var unit = t('unit')
        var d = f.radius * 2 * inv
        var r = f.radius * inv
        return {
          title: t('circle'),
          rows: [
            { label: t('diameter'), value: 'Ø ' + fmtDim(d) + ' ' + unit },
            { label: t('radius'), value: 'R ' + fmtDim(r) + ' ' + unit }
          ],
          main: 'Ø ' + fmtDim(d) + ' ' + unit,
          sub: 'R ' + fmtDim(r) + ' ' + unit,
          delta: '',
          a: f.center,
          b: f.center
        }
      }

      function addPick(clientX, clientY, free) {
        if (!mesh) return
        var feature = pickFeature(clientX, clientY, !!free)
        if (!feature) return
        if (picks.length >= 2) picks = []
        // 同一个点 / 同一条棱 / 同一块平面点了第二次：当作误触，不重选
        if (picks.length === 1 && sameFeature(picks[0], feature)) return
        picks.push(feature)
        hover = null
        measure = computeMeasure()
        single = picks.length === 1 ? singleOf(picks[0]) : null
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
        measure = null
        single = null
        if (measureMode) {
          // 量尺寸时把运动冻住：零件还在转的话，读数和吸附都会追着跑
          if (mesh && mesh.parts) {
            for (var i = 0; i < mesh.parts.length; i++) mesh.parts[i].speed = 0
          }
          explodePlaying = false
          lastMotionAt = 0
          invalidateTopology()
          if (motionMode) {
            motionMode = false
            selectedPart = -1
            notifyMotion()
          }
        }
        canvas.style.cursor = measureMode ? 'crosshair' : 'grab'
        updateLabel()
        invalidate()
        notifyMeasure()
      }

      function clearMeasure() {
        picks = []
        hover = null
        measure = null
        single = null
        updateLabel()
        invalidate()
        notifyMeasure()
      }

      /**
       * 建一次三脚标的 DOM，之后每帧只改坐标。
       * 用 SVG 而不是 GL：文字清晰、跟主题走、也不占渲染管线。
       */
      function buildAxis() {
        if (!axisEl || typeof document === 'undefined') return
        var ns = 'http://www.w3.org/2000/svg'
        var parts = { lines: [], labels: [], rings: [] }
        var colors = ['#f2555a', '#57c98a', '#6aa8ff']
        var names = ['X', 'Y', 'Z']
        for (var i = 0; i < 3; i++) {
          var line = document.createElementNS(ns, 'line')
          line.setAttribute('stroke', colors[i])
          line.setAttribute('stroke-width', '1.6')
          line.setAttribute('stroke-linecap', 'round')
          axisEl.appendChild(line)
          parts.lines.push(line)
        }
        // 轴线正对镜头时退化成圆环，先建好藏着
        for (var r = 0; r < 3; r++) {
          var ring = document.createElementNS(ns, 'circle')
          ring.setAttribute('r', '4')
          ring.setAttribute('fill', 'none')
          ring.setAttribute('stroke', colors[r])
          ring.setAttribute('stroke-width', '1.6')
          ring.setAttribute('cx', '30')
          ring.setAttribute('cy', '30')
          axisEl.appendChild(ring)
          parts.rings.push(ring)
        }
        for (var k = 0; k < 3; k++) {
          var text = document.createElementNS(ns, 'text')
          text.textContent = names[k]
          text.setAttribute('fill', colors[k])
          text.setAttribute('font-size', '9')
          text.setAttribute('font-weight', '600')
          text.setAttribute('text-anchor', 'middle')
          text.setAttribute('dominant-baseline', 'middle')
          axisEl.appendChild(text)
          parts.labels.push(text)
        }
        axisParts = parts
        updateAxis()
      }

        /** 把世界坐标的三根轴投到屏幕，按相机朝向更新三脚标。 */
      function updateAxis() {
        if (!axisEl || !axisParts) return
        axisEl.style.display = showAxis ? '' : 'none'
        if (!showAxis) return

        // 与 lookAt 同一套基：翻滚过也不会算歪
        var basis = camBasis(cam)
        var fx = basis.fwd[0], fy = basis.fwd[1], fz = basis.fwd[2]
        var rx = basis.right[0], ry = basis.right[1], rz = basis.right[2]
        var ux = basis.up[0], uy = basis.up[1], uz = basis.up[2]

        // 模型的三根轴在渲染空间的方向（见模块级 MODEL_AXES）
        var axes = MODEL_AXES
        for (var i = 0; i < 3; i++) {
          var a = axes[i]
          var sx = a[0] * rx + a[1] * ry + a[2] * rz
          var sy = -(a[0] * ux + a[1] * uy + a[2] * uz)
          var depth = a[0] * fx + a[1] * fy + a[2] * fz
          var len = Math.sqrt(sx * sx + sy * sy)
          var line = axisParts.lines[i]
          var ring = axisParts.rings[i]
          var label = axisParts.labels[i]
          // 朝向观众的那根不透明度满格，背过去的压暗，读起来有前后
          var alpha = depth < 0 ? 1 : 0.4
          line.setAttribute('opacity', String(alpha))
          ring.setAttribute('opacity', String(alpha))
          label.setAttribute('opacity', String(depth < 0 ? 0.95 : 0.55))

          if (len < 0.12) {
            // 正对镜头：画个圈，字放下面一点，别压在中心
            line.setAttribute('x1', '30')
            line.setAttribute('y1', '30')
            line.setAttribute('x2', '30')
            line.setAttribute('y2', '30')
            ring.style.display = ''
            label.setAttribute('x', '30')
            label.setAttribute('y', '41')
            continue
          }

          ring.style.display = 'none'
          line.setAttribute('x1', '30')
          line.setAttribute('y1', '30')
          line.setAttribute('x2', String(30 + sx * 20))
          line.setAttribute('y2', String(30 + sy * 20))
          label.setAttribute('x', String(30 + sx * 25))
          label.setAttribute('y', String(30 + sy * 25))
        }
      }

      function setAxisEl(el) {
        axisEl = el || null
        axisParts = null
        if (axisEl) buildAxis()
      }

      function setShowAxis(on) {
        var next = !!on
        if (next === showAxis) return
        showAxis = next
        updateAxis()
        if (viewListener) viewListener(wire, spin, showAxis)
      }

      function setLabelEls(box, dist, mode, delta) {
        labelEls = box
          ? { box: box, dist: dist || null, mode: mode || null, delta: delta || null }
          : null
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
        cam.q = [0, 0, 0, 1]
        cam.fit = (radius / Math.sin(FOV / 2)) * 1.12
        cam.dist = cam.fit
        cam.min = Math.max(0.02, radius * 0.15)
        cam.max = Math.max(4, radius * 30)
        tween = null
        invalidate()
      }

      function eyeToTarget() {
        // 从目标点指向相机的方向
        return camBasis(cam).dir
      }

      function orbit(dx, dy) {
        var basis = camBasis(cam)
        // 两个轴都在屏幕空间：横向绕"屏幕上的上"，纵向绕"屏幕上的右"
        var qx = qAxisAngle(basis.right, -dy * ORBIT_SPEED)
        var qy = qAxisAngle(basis.up, -dx * ORBIT_SPEED)
        cam.q = qMultiply(qy, qMultiply(qx, cam.q || [0, 0, 0, 1]))
        invalidate()
      }

      function pan(dx, dy) {
        var basis = camBasis(cam)
        var rx = basis.right[0], ry = basis.right[1], rz = basis.right[2]
        var ux2 = basis.up[0], uy2 = basis.up[1], uz2 = basis.up[2]

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

      // ---------------- 视角预设 / 显示模式 ----------------

      function now() {
        return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
      }

      // 俯视用 1.5607 而不是 π/2：lookAt 的 up 在正上方会退化
      var VIEWS = {
        front: { yaw: 0, pitch: 0 },
        top: { yaw: 0, pitch: 1.5607 },
        right: { yaw: Math.PI / 2, pitch: 0 },
        iso: { yaw: 0.85, pitch: 0.42 }
      }

      /** 转到标准视角：只动角度，缩放和焦点都保留，过渡 260ms。 */
      function setView(name) {
        var v = VIEWS[name]
        if (!v) return false
        var y0 = cam.yaw
        var y1 = v.yaw
        // 走最短的一圈，别绕远路
        while (y1 - y0 > Math.PI) y1 -= Math.PI * 2
        while (y1 - y0 < -Math.PI) y1 += Math.PI * 2
        cam.q = [0, 0, 0, 1]
        tween = { y0: y0, y1: y1, p0: cam.pitch, p1: v.pitch, t0: now(), dur: 260 }
        invalidate()
        return true
      }

      /** 线框：每个三角面三条边，第一次开的时候才建缓冲。 */
      function buildWire() {
        if (!gl || !mesh) return
        var count = mesh.positions.length / 9
        var out = new Float32Array(count * 18)
        var p = 0
        for (var tri = 0; tri < count; tri++) {
          var o = tri * 9
          for (var e = 0; e < 3; e++) {
            var i0 = o + e * 3
            var i1 = o + ((e + 1) % 3) * 3
            out[p++] = mesh.positions[i0]
            out[p++] = mesh.positions[i0 + 1]
            out[p++] = mesh.positions[i0 + 2]
            out[p++] = mesh.positions[i1]
            out[p++] = mesh.positions[i1 + 1]
            out[p++] = mesh.positions[i1 + 2]
          }
        }
        if (!wireBuffer) wireBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, wireBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW)
        wireCount = out.length / 3
      }

      function setWire(on) {
        var next = !!on
        if (next === wire) return
        wire = next
        if (wire && !wireCount) buildWire()
        if (viewListener) viewListener(wire, spin, showAxis)
        invalidate()
      }

      function setSpin(on) {
        var next = !!on
        if (next === spin) return
        spin = next
        if (viewListener) viewListener(wire, spin, showAxis)
        invalidate()
      }

      function onViewChange(fn) {
        viewListener = typeof fn === 'function' ? fn : null
      }

      /** 导出当前画面为 PNG data URL（preserveDrawingBuffer 已开）。 */
      function snapshot() {
        if (!gl || !mesh) return null
        drawFrameNow()
        try {
          return canvas.toDataURL('image/png')
        } catch (e) {
          return null
        }
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

      /** 把一个三角形写进顶点列表（填充用），沿法线抬一点点。 */
      function faceVertices(o, out) {
        var pl = facePlane(mesh.positions, o)
        var eps = (mesh.radius || 1) * 0.0016
        for (var i = 0; i < 9; i += 3) {
          out.push(
            mesh.positions[o + i] + pl.n[0] * eps,
            mesh.positions[o + i + 1] + pl.n[1] * eps,
            mesh.positions[o + i + 2] + pl.n[2] * eps
          )
        }
      }

      /**
       * 一块共面区域的外轮廓。区域里每条内部边都被两个三角形共用，
       * 只出现一次的就是轮廓；不画内部三角形边，高亮才不会花。
       */
      function regionOutline(offsets, out) {
        var pos = mesh.positions
        var eps = (mesh.radius || 1) * 0.0016
        var pl = facePlane(pos, offsets[0])
        var seen = Object.create(null)
        for (var i = 0; i < offsets.length; i++) {
          var o = offsets[i]
          for (var e = 0; e < 3; e++) {
            var i0 = o + EDGE_TRIS[e][0] * 3
            var i1 = o + EDGE_TRIS[e][1] * 3
            var k = edgeKeyOf(pos, i0, i1)
            var rec = seen[k]
            if (rec) {
              rec.count++
              continue
            }
            seen[k] = { count: 1, a: i0, b: i1 }
          }
        }
        for (var key in seen) {
          var r = seen[key]
          if (r.count !== 1) continue
          out.push(
            pos[r.a] + pl.n[0] * eps,
            pos[r.a + 1] + pl.n[1] * eps,
            pos[r.a + 2] + pl.n[2] * eps,
            pos[r.b] + pl.n[0] * eps,
            pos[r.b + 1] + pl.n[1] * eps,
            pos[r.b + 2] + pl.n[2] * eps
          )
        }
      }

      function pushSeg(out, a, b) {
        out.push(a[0], a[1], a[2], b[0], b[1], b[2])
      }

      /** 棱画成线，点画成圆点；面不在这里画（面是填充 + 描边）。 */
      function featureStrokes(f, lines, dots) {
        if (!f) return
        if (f.kind === 'edge') {
          pushSeg(lines, f.a, f.b)
          if (dots) {
            dots.push(f.a[0], f.a[1], f.a[2])
            dots.push(f.b[0], f.b[1], f.b[2])
          }
        } else if (f.kind === 'circle') {
          // 圆边界本来就是一圈折边，照着描一圈，再点出圆心
          if (f.loop) {
            for (var i = 1; i < f.loop.length; i++) pushSeg(lines, f.loop[i - 1], f.loop[i])
          }
          if (dots) {
            dots.push(f.center[0], f.center[1], f.center[2])
            if (f.loop && f.loop.length) dots.push(f.loop[0][0], f.loop[0][1], f.loop[0][2])
          }
        } else if (f.kind === 'point' && dots) {
          dots.push(f.p[0], f.p[1], f.p[2])
        }
      }

      /**
       * 选中的要素上色：面填一层半透明橙 + 描边，棱画粗线，点画圆点。
       * 面与描边做深度测试，避免透过模型"漏"到背面；连线和端点关掉深度测试。
       */
      function drawOverlay() {
        if (!gl || !overlayProgram || !mesh) return

        var i
        var pickedFaces = []
        var hoverFaces = []
        function collectFaces(f, out) {
          if (!f || f.kind !== 'face') return
          for (var k = 0; k < f.region.length; k++) out.push(f.region[k])
        }
        for (i = 0; i < picks.length; i++) collectFaces(picks[i], pickedFaces)
        collectFaces(hover, hoverFaces)

        gl.useProgram(overlayProgram)
        gl.uniformMatrix4fv(overlayVP, false, vpMatrix)
        gl.bindBuffer(gl.ARRAY_BUFFER, overlayBuffer)
        gl.enableVertexAttribArray(overlayPos)
        gl.vertexAttribPointer(overlayPos, 3, gl.FLOAT, false, 0, 0)
        gl.uniform1f(overlayRound, 0)
        gl.uniform1f(overlaySize, 1)

        gl.enable(gl.DEPTH_TEST)
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        gl.depthMask(false)

        var fill = []
        for (i = 0; i < pickedFaces.length; i++) faceVertices(pickedFaces[i], fill)
        if (fill.length) {
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(fill), gl.DYNAMIC_DRAW)
          gl.uniform4f(overlayColor, ACCENT[0], ACCENT[1], ACCENT[2], 0.34)
          gl.drawArrays(gl.TRIANGLES, 0, fill.length / 3)
        }

        var hoverFill = []
        for (i = 0; i < hoverFaces.length; i++) {
          if (pickedFaces.indexOf(hoverFaces[i]) >= 0) continue
          faceVertices(hoverFaces[i], hoverFill)
        }
        if (hoverFill.length) {
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(hoverFill), gl.DYNAMIC_DRAW)
          gl.uniform4f(overlayColor, ACCENT[0], ACCENT[1], ACCENT[2], 0.14)
          gl.drawArrays(gl.TRIANGLES, 0, hoverFill.length / 3)
        }

        gl.depthMask(true)
        gl.disable(gl.BLEND)

        // 线一律关深度测试画，被模型挡住也看得见
        gl.disable(gl.DEPTH_TEST)

        var lines = []
        if (pickedFaces.length) regionOutline(pickedFaces, lines)
        for (i = 0; i < picks.length; i++) featureStrokes(picks[i], lines, null)
        if (lines.length) {
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW)
          gl.uniform4f(overlayColor, ACCENT[0], ACCENT[1], ACCENT[2], 0.9)
          gl.drawArrays(gl.LINES, 0, lines.length / 3)
        }

        var hoverLines = []
        if (hover && hover.kind === 'face') regionOutline(hover.region, hoverLines)
        featureStrokes(hover, hoverLines, null)
        if (hoverLines.length) {
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(hoverLines), gl.DYNAMIC_DRAW)
          gl.uniform4f(overlayColor, ACCENT[0], ACCENT[1], ACCENT[2], 0.45)
          gl.drawArrays(gl.LINES, 0, hoverLines.length / 3)
        }

        if (measure) {
          var len = vecDist(measure.a, measure.b)
          if (len > 1e-4) {
            gl.bufferData(
              gl.ARRAY_BUFFER,
              new Float32Array([
                measure.a[0], measure.a[1], measure.a[2],
                measure.b[0], measure.b[1], measure.b[2]
              ]),
              gl.DYNAMIC_DRAW
            )
            gl.uniform4f(overlayColor, ACCENT[0], ACCENT[1], ACCENT[2], ACCENT[3])
            gl.drawArrays(gl.LINES, 0, 2)
          }
        }

        var dots = []
        for (i = 0; i < picks.length; i++) featureStrokes(picks[i], [], dots)
        featureStrokes(hover, [], dots)
        if (measure) {
          dots.push(measure.a[0], measure.a[1], measure.a[2])
          dots.push(measure.b[0], measure.b[1], measure.b[2])
        }
        if (dots.length) {
          gl.enable(gl.BLEND)
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
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
          gl.disable(gl.BLEND)
        }

        gl.enable(gl.DEPTH_TEST)
      }

      /** 立刻画一帧：导出 PNG 前要，截图不能等下一次 raf。 */
      function drawFrameNow() {
        if (rafId) {
          cancelAnimationFrame(rafId)
          rafId = 0
        }
        drawQueued = false
        drawFrame()
      }

      /** 线框用叠加层程序画 LINES，颜色比模型淡一点。 */
      function drawWire() {
        if (!gl || !overlayProgram || !wireCount) return
        gl.useProgram(overlayProgram)
        gl.uniformMatrix4fv(overlayVP, false, vpMatrix)
        gl.bindBuffer(gl.ARRAY_BUFFER, wireBuffer)
        gl.enableVertexAttribArray(overlayPos)
        gl.vertexAttribPointer(overlayPos, 3, gl.FLOAT, false, 0, 0)
        gl.uniform1f(overlayRound, 0)
        gl.uniform1f(overlaySize, 1)
        gl.uniform4f(overlayColor, 0.62, 0.68, 0.78, 0.55)
        gl.enable(gl.DEPTH_TEST)
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        gl.drawArrays(gl.LINES, 0, wireCount)
        gl.disable(gl.BLEND)
      }

      function drawFrame() {
        rafId = 0
        drawQueued = false

        // 视角过渡：缓入缓出，只在过渡期间自己续帧
        if (tween) {
          var tp = clamp((now() - tween.t0) / tween.dur, 0, 1)
          var te = tp < 0.5 ? 2 * tp * tp : 1 - Math.pow(-2 * tp + 2, 2) / 2
          cam.yaw = tween.y0 + (tween.y1 - tween.y0) * te
          cam.pitch = tween.p0 + (tween.p1 - tween.p0) * te
          if (tp >= 1) tween = null
          else invalidate()
        }

        // 装配体运动：分解动画和零件自转都在这一帧推进（没在动时几乎不花钱）
        if (mesh && mesh.parts) {
          advanceMotion(now())
          // 还有东西在动就续帧，停了就自然静下来
          if (explodePlaying || motionSpinning()) invalidate()
        }

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

        var basis = camBasis(cam)
        var dir = basis.dir
        var eye = [
          cam.target[0] + dir[0] * cam.dist,
          cam.target[1] + dir[1] * cam.dist,
          cam.target[2] + dir[2] * cam.dist
        ]
        lookAt(viewMatrix, eye, cam.target, basis.up)
        multiply(vpMatrix, projMatrix, viewMatrix)

        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

        gl.useProgram(program)
        gl.uniformMatrix4fv(uniformVP, false, vpMatrix)
        if (wire) {
          // 线框模式：实体压暗，把注意力让给边线
          gl.uniform3f(uniformBase, BASE_COLOR[0] * 0.26, BASE_COLOR[1] * 0.26, BASE_COLOR[2] * 0.26)
          gl.enable(gl.POLYGON_OFFSET_FILL)
          gl.polygonOffset(1, 1)
        } else {
          gl.uniform3f(uniformBase, BASE_COLOR[0], BASE_COLOR[1], BASE_COLOR[2])
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
        gl.enableVertexAttribArray(attribPos)
        gl.vertexAttribPointer(attribPos, 3, gl.FLOAT, false, 0, 0)

        gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuffer)
        gl.enableVertexAttribArray(attribNrm)
        gl.vertexAttribPointer(attribNrm, 3, gl.FLOAT, false, 0, 0)

        gl.drawArrays(gl.TRIANGLES, 0, vertexCount)

        if (wire) {
          gl.disable(gl.POLYGON_OFFSET_FILL)
          drawWire()
        }

        if (measureMode || picks.length || measure) drawOverlay()
        updateLabel()
        updateAxis()

        // 自动旋转：一直续帧，直到用户关掉
        if (spin) {
          cam.yaw += 0.007
          invalidate()
        }
      }

      function invalidate() {
        if (rafId || !attached) return
        rafId = requestAnimationFrame(drawFrame)
      }

      // ---------------- 交互 ----------------

      function onPointerDown(e) {
        if (e.button === 0 && measureMode) {
          // 测量模式：左键仍是"拖动旋转"，没拖动才算取点；Shift 表示不吸附
          drag = { mode: 'pick', free: !!e.shiftKey, x: e.clientX, y: e.clientY, moved: 0 }
        } else if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey) || e.ctrlKey || e.metaKey) {
          drag = { mode: 'pan', x: e.clientX, y: e.clientY, moved: 0 }
        } else if (e.button === 0) {
          drag = { mode: 'orbit', x: e.clientX, y: e.clientY, moved: 0 }
        } else {
          return
        }
        canvas.style.cursor = drag.mode === 'pan' ? 'move' : (drag.mode === 'pick' ? 'crosshair' : 'grabbing')
        try { canvas.focus({ preventScroll: true }) } catch (e2) {}
        e.preventDefault()
      }

      function onPointerMove(e) {
        if (!drag) {
          if (measureMode) updateHover(e.clientX, e.clientY)
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
        e.preventDefault()
      }

      function onPointerLeave() {
        if (hover) {
          hover = null
          invalidate()
        }
      }

      function onPointerUp(e) {
        if (!drag) return
        var wasPick = drag.mode === 'pick'
        var wasOrbit = drag.mode === 'orbit'
        var free = !!drag.free
        var moved = drag.moved
        var x = e && typeof e.clientX === 'number' ? e.clientX : drag.x
        var y = e && typeof e.clientY === 'number' ? e.clientY : drag.y
        var cancelled = !!(e && e.type === 'pointercancel')
        drag = null
        canvas.style.cursor = measureMode ? 'crosshair' : 'grab'
        if (cancelled) return
        if (wasPick && moved < 4) addPick(x, y, free)
        // 运动面板开着时，点一下零件就选中它；拖动仍然是转视角
        else if (wasOrbit && motionMode && moved < 4) pickPart(x, y)
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
            measure = null
            single = null
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
          return
        }
        if (e.key === 'w' || e.key === 'W') {
          e.preventDefault()
          setWire(!wire)
          return
        }
        if (e.key === 'a' || e.key === 'A') {
          e.preventDefault()
          setSpin(!spin)
          return
        }
        if (e.key === 'g' || e.key === 'G') {
          e.preventDefault()
          setShowAxis(!showAxis)
          return
        }
        if (e.key >= '1' && e.key <= '4') {
          e.preventDefault()
          setView(['front', 'top', 'right', 'iso'][Number(e.key) - 1])
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
          bind(canvas, 'pointerleave', onPointerLeave),
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
        measure = null
        single = null
        featureEdges = null
        corners = null
        featureAdj = null
        circleCache = null
        topoReady = false
        measureMode = false
        labelEls = null
        panelEl = null
        panelSig = ''
        axisEl = null
        axisParts = null
        wire = false
        wireBuffer = null
        wireCount = 0
        spin = false
        tween = null
        viewListener = null
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
        setPanelEl: setPanelEl,
        setAxisEl: setAxisEl,
        setShowAxis: setShowAxis,
        onMeasureChange: onMeasureChange,
        isMeasuring: function () { return measureMode },
        // 视角与显示
        setView: setView,
        setWire: setWire,
        setSpin: setSpin,
        onViewChange: onViewChange,
        snapshot: snapshot,
        // 装配体运动
        setMotionMode: setMotionMode,
        onMotionChange: onMotionChange,
        setExplode: setExplode,
        playExplode: playExplode,
        setPartSpin: setPartSpin,
        setCoupled: setCoupled,
        setPartTeeth: setPartTeeth,
        setPartAxis: setPartAxis,
        selectPart: selectPart,
        pickPart: pickPart,
        resetMotion: resetMotion,
        motionState: motionState,
        // 测试用把手：e2e 靠它把"点到了哪个面 / 屏幕坐标"读出来，
        // 不用靠猜像素位置。故意放在 _test 下，不当作公开 API。
        _test: {
          pickFace: pickFace,
          pickFeature: pickFeature,
          project: project,
          picks: function () { return picks },
          measure: function () { return measure },
          single: function () { return single },
          clear: clearMeasure,
          camera: function () {
            var basis = camBasis(cam)
            return { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, dir: basis.dir, up: basis.up }
          },
          wire: function () { return wire },
          spin: function () { return spin },
          axis: function () { return showAxis },
          snapshot: snapshot,
          motion: motionState,
          parts: function () { return mesh && mesh.parts ? mesh.parts : null },
          partAngle: function (i) {
            var p = mesh && mesh.parts ? mesh.parts[i] : null
            return p ? p.angle : null
          },
          // 某个零件第一个三角形的九个坐标：证明变换真的写进了顶点
          vertices: function (i) {
            var p = mesh && mesh.parts ? mesh.parts[i] : null
            if (!p) return null
            return Array.prototype.slice.call(mesh.positions, p.start * 9, p.start * 9 + 9)
          },
          resetMotion: resetMotion,
          setExplode: setExplode,
          setPartSpin: setPartSpin,
          setCoupled: setCoupled,
          setPartTeeth: setPartTeeth,
          gears: function () { return motionState().gears },
          setPartAxis: setPartAxis,
          selectPart: selectPart,
          motionMode: function () { return motionMode },
          explode: function () { return explode }
        }
      }
    }

    // ==================================================================
    // React 组件
    // ==================================================================

    // 面板里的字走一条中文优先的字体栈。外面容器如果换成了等宽或纯拉丁字体，
    // 中文会掉进系统默认的宋体，和界面上其他文字不是一套字形。
    var FONT_UI =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", ' +
      '"Microsoft YaHei", "Helvetica Neue", Arial, sans-serif'

    var ROOT_STYLE = {
      position: 'relative',
      fontFamily: FONT_UI,
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

    // 视图菜单：透明背板吃掉外部点击，菜单本体贴在按钮下方
    var MENU_BACKDROP_STYLE = {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 4
    }

    var MENU_STYLE = {
      position: 'absolute',
      top: '36px',
      right: '8px',
      minWidth: '134px',
      padding: '4px',
      borderRadius: '8px',
      border: '1px solid rgba(128,128,128,0.34)',
      background: 'rgba(28,28,32,0.96)',
      color: 'inherit',
      boxShadow: '0 8px 22px rgba(0,0,0,0.34)',
      display: 'flex',
      flexDirection: 'column',
      gap: '1px',
      zIndex: 5
    }

    var MENU_ITEM_STYLE = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      height: '24px',
      padding: '0 8px',
      border: 'none',
      borderRadius: '5px',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      fontSize: '11px',
      lineHeight: '1',
      cursor: 'pointer',
      textAlign: 'left',
      whiteSpace: 'nowrap'
    }

    var MENU_ITEM_ON_STYLE = {
      background: 'rgba(255,173,76,0.18)'
    }

    var MENU_KEY_STYLE = {
      opacity: 0.5,
      fontSize: '10px'
    }

    var MENU_SPLIT_STYLE = {
      height: '1px',
      margin: '3px 4px',
      background: 'rgba(128,128,128,0.26)'
    }

    // 运动面板：右侧一整块，分解滑块 + 零件列表 + 选中零件的轴与转速
    var MOTION_STYLE = {
      position: 'absolute',
      top: '36px',
      right: '8px',
      width: '196px',
      padding: '8px',
      borderRadius: '9px',
      border: '1px solid rgba(128,128,128,0.34)',
      background: 'rgba(28,28,32,0.96)',
      color: 'inherit',
      boxShadow: '0 8px 22px rgba(0,0,0,0.34)',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      zIndex: 5,
      pointerEvents: 'auto'
    }

    var MOTION_TITLE_STYLE = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontSize: '11px',
      fontWeight: '600',
      opacity: 0.9
    }

    var MOTION_ROW_STYLE = {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '11px'
    }

    var MOTION_LABEL_STYLE = {
      minWidth: '32px',
      opacity: 0.72,
      fontSize: '10px'
    }

    var MOTION_RANGE_STYLE = {
      flex: '1',
      minWidth: '0',
      height: '16px',
      accentColor: '#ffad4c',
      cursor: 'pointer'
    }

    var MOTION_LIST_STYLE = {
      display: 'flex',
      flexDirection: 'column',
      gap: '1px',
      maxHeight: '150px',
      overflowY: 'auto'
    }

    var MOTION_PART_STYLE = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '6px',
      height: '22px',
      padding: '0 6px',
      border: 'none',
      borderRadius: '5px',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      fontSize: '11px',
      lineHeight: '1',
      cursor: 'pointer',
      textAlign: 'left',
      whiteSpace: 'nowrap'
    }

    var MOTION_PART_ON_STYLE = {
      background: 'rgba(255,173,76,0.2)'
    }

    var MOTION_DOT_STYLE = {
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      background: '#ffad4c',
      flex: '0 0 auto'
    }

    var MOTION_TOGGLE_STYLE = merge(BUTTON_STYLE, {
      height: '20px',
      padding: '0 8px',
      fontSize: '10px'
    })
    var MOTION_TOGGLE_ON_STYLE = merge(MOTION_TOGGLE_STYLE, BUTTON_ON_STYLE)
    var MOTION_RATIO_STYLE = merge(MOTION_LABEL_STYLE, {
      marginLeft: 'auto',
      fontVariantNumeric: 'tabular-nums',
      color: '#ffcf9a'
    })

    var MOTION_INPUT_STYLE = {
      width: '56px',
      height: '20px',
      marginLeft: 'auto',
      border: '1px solid rgba(255,255,255,0.16)',
      borderRadius: '4px',
      background: 'rgba(22,22,24,0.6)',
      color: '#ffe1bb',
      fontSize: '10px',
      textAlign: 'right',
      padding: '0 4px'
    }

    var MOTION_HINT_STYLE = {
      fontSize: '10px',
      lineHeight: '1.45',
      opacity: 0.6
    }

    var HELP_STYLE = {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(10,10,12,0.5)',
      zIndex: 6
    }

    var HELP_CARD_STYLE = {
      minWidth: '236px',
      maxWidth: '88%',
      padding: '10px 12px',
      borderRadius: '9px',
      border: '1px solid rgba(128,128,128,0.34)',
      background: 'rgba(28,28,32,0.97)',
      color: 'inherit',
      boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
      display: 'flex',
      flexDirection: 'column',
      gap: '3px',
      font: 'inherit',
      fontSize: '11px',
      lineHeight: '1.5'
    }

    var HELP_TITLE_STYLE = {
      fontSize: '10px',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      opacity: 0.62,
      marginBottom: '2px'
    }

    var HELP_ROW_STYLE = {
      whiteSpace: 'nowrap'
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

    var LABEL_MODE_STYLE = {
      display: 'block',
      fontSize: '10px',
      opacity: 0.72,
      marginTop: '1px'
    }

    var LABEL_DELTA_STYLE = {
      display: 'block',
      fontSize: '10px',
      opacity: 0.66
    }

    var PANEL_STYLE = {
      position: 'absolute',
      top: '8px',
      left: '8px',
      minWidth: '150px',
      padding: '6px 8px',
      borderRadius: '7px',
      border: '1px solid rgba(255,173,76,0.55)',
      background: 'rgba(22,22,24,0.86)',
      color: '#ffe1bb',
      font: 'inherit',
      fontSize: '11px',
      lineHeight: '1.45',
      display: 'none',
      pointerEvents: 'none',
      zIndex: 3
    }

    var PANEL_TITLE_STYLE =
      'font-size:10px;letter-spacing:0.04em;text-transform:uppercase;opacity:0.62;margin-bottom:3px'

    var PANEL_ROW_STYLE = 'display:flex;justify-content:space-between;gap:10px;white-space:nowrap'

    var PANEL_LABEL_STYLE = 'opacity:0.66'

    var PANEL_VALUE_STYLE = 'font-weight:600'

    var AXIS_STYLE = {
      position: 'absolute',
      right: '10px',
      bottom: '34px',
      width: '60px',
      height: '60px',
      pointerEvents: 'none',
      opacity: 0.9,
      zIndex: 2
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

    var CONVERT_HINT_STYLE = {
      maxWidth: '260px',
      marginTop: '2px',
      fontSize: '11px',
      opacity: 0.55,
      textAlign: 'center',
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
      var panelRef = useRef(null)
      var axisRef = useRef(null)
      var distRef = useRef(null)
      var modeRef = useRef(null)
      var deltaRef = useRef(null)
      var propsRef = useRef(props)
      var cancelRef = useRef(null)
      propsRef.current = props

      var [phase, setPhase] = useState('loading')
      var [message, setMessage] = useState('')
      var [stats, setStats] = useState(null)
      var [attempt, setAttempt] = useState(0)
      var [measuring, setMeasuring] = useState(false)
      var [pickCount, setPickCount] = useState(0)
      var [menu, setMenu] = useState(false)
      var [help, setHelp] = useState(false)
      var [wireOn, setWireOn] = useState(false)
      var [spinOn, setSpinOn] = useState(false)
      var [axisOn, setAxisOn] = useState(true)
      var [progress, setProgress] = useState(0)
      var [motionOn, setMotionOn] = useState(false)
      var [motion, setMotionState] = useState({ on: false, explode: 0, playing: false, selected: -1, coupled: true, gears: { pairs: [] }, parts: [] })
      var [uiLang, setUiLang] = useState(getLang())

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
        viewer.setLabelEls(labelRef.current, distRef.current, modeRef.current, deltaRef.current)
        viewer.setPanelEl(panelRef.current)
        viewer.setAxisEl(axisRef.current)
        viewer.onMeasureChange(function (on, count) {
          setMeasuring(!!on)
          setPickCount(count || 0)
        })
        viewer.onViewChange(function (w, s, a) {
          setWireOn(!!w)
          setSpinOn(!!s)
          setAxisOn(!!a)
        })
        viewer.onMotionChange(function (state) {
          setMotionOn(!!state.on)
          setMotionState(state)
        })
        return function () {
          viewer.onMeasureChange(null)
          viewer.onViewChange(null)
          viewer.onMotionChange(null)
          viewer.setLabelEls(null, null, null, null)
          viewer.setPanelEl(null)
          viewer.setAxisEl(null)
        }
      }, [])

      // 语言一变就重画一遍：所有文案都是渲染时查表的，不用重新挂渲染器
      useEffect(function () {
        onLangChange(function (next) { setUiLang(next) })
        return function () { onLangChange(null) }
      }, [])

      // 测量中按 Esc 退出（画布不一定有焦点，所以挂到 window）
      useEffect(function () {
        if (!measuring && !menu && !help && !motionOn) return
        var onKey = function (e) {
          if (e.key !== 'Escape') return
          if (motionOn) {
            var mv = viewerRef.current
            if (mv) mv.setMotionMode(false)
            setMenu(false)
          } else if (menu) setMenu(false)
          else if (help) setHelp(false)
          else {
            var viewer = viewerRef.current
            if (viewer) viewer.setMeasureMode(false)
          }
        }
        window.addEventListener('keydown', onKey)
        return function () { window.removeEventListener('keydown', onKey) }
      }, [measuring, menu, help, motionOn])

      // 可见性：切回这个标签页时补一次尺寸 + 重绘
      useEffect(function () {
        var viewer = viewerRef.current
        if (!viewer) return
        if (visible) {
          viewer.resize()
          viewer.invalidate()
        }
      }, [visible])

      // 读字节 → 解析（STL 本地、STEP 交宿主）→ 喂给渲染器
      useEffect(function () {
        var alive = true
        setPhase('loading')
        setMessage('')
        setProgress(0)
        setMenu(false)
        setHelp(false)

        var current = propsRef.current
        var url = current.mediaUrl
        var inline = toBytes(current.content)
        var name = current.path || ''
        var step = isStepPath(name)
        var controller = typeof AbortController === 'function' ? new AbortController() : null
        var signal = controller ? controller.signal : undefined
        var startedAt = Date.now()
        var ticker = 0
        cancelRef.current = controller

        if (step) {
          setPhase('converting')
          ticker = setInterval(function () {
            if (!alive) return
            setProgress((Date.now() - startedAt) / 1000)
          }, 200)
        }

        var source
        if (url) {
          source = fetch(url, { credentials: 'same-origin', signal: signal }).then(function (res) {
            if (!res.ok) {
              throw new Error('HTTP ' + res.status + ' ' + res.statusText)
            }
            return res.arrayBuffer()
          })
        } else if (inline) {
          source = Promise.resolve(inline)
        } else {
          source = Promise.reject(new Error('no file source'))
        }

        source.then(function (payload) {
          if (!step) {
            var bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
            return parseStl(bytes)
          }
          var body = payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload
          // 只把扩展名放进查询串：header 只吃 ISO-8859-1，中文文件名会把 fetch 直接抛错。
          var suffix = (String(name).match(/\.([A-Za-z0-9]+)$/) || [])[1] || 'step'
          return fetch(hostRoute(CONVERT_ROUTE) + '?ext=' + encodeURIComponent(suffix.toLowerCase()), {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'content-type': 'application/octet-stream'
            },
            body: body,
            signal: signal
          }).then(function (res) {
            if (res.status === 404) throw new Error(t('stepUnavailable'))
            if (res.status === 413) throw new Error(t('stepTooLarge'))
            if (!res.ok) {
              return res.text().then(null, function () { return '' }).then(function (text) {
                var detail = text ? ' · ' + String(text).slice(0, 240) : ''
                throw new Error('HTTP ' + res.status + detail)
              })
            }
            return res.arrayBuffer()
          }).then(function (buffer) {
            return stepMesh(decodeMesh(buffer))
          })
        }).then(function (parsed) {
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
            dims: parsed.dims,
            info: parsed.info,
            parts: parsed.parts || 1
          })
          setPhase('ready')
        }).catch(function (err) {
          if (!alive) return
          if (err && (err.name === 'AbortError' || err.code === 20)) {
            setPhase('error')
            setMessage(t('cancelled'))
            return
          }
          var detail = err && err.message ? err.message : String(err)
          setPhase('error')
          setMessage(t('loadFailed') + ' · ' + detail)
        }).then(function () {
          if (ticker) clearInterval(ticker)
          if (alive) cancelRef.current = null
        })

        return function () {
          alive = false
          if (ticker) clearInterval(ticker)
          if (controller) {
            try { controller.abort() } catch (e) { /* 已经结束了 */ }
          }
        }
      }, [mediaUrl, filePath, attempt])

      var onRetry = function (e) {
        if (e && e.stopPropagation) e.stopPropagation()
        setAttempt(function (n) { return n + 1 })
      }

      var onCancel = function (e) {
        if (e && e.stopPropagation) e.stopPropagation()
        var controller = cancelRef.current
        if (controller) {
          try { controller.abort() } catch (err) { /* 已经结束了 */ }
        }
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

      var stop = function (e) {
        if (e && e.stopPropagation) e.stopPropagation()
      }

      // 菜单点完把焦点还给画布，否则键盘快捷键要再点一下才生效
      var focusCanvas = function () {
        var canvas = canvasRef.current
        if (canvas && typeof canvas.focus === 'function') {
          try { canvas.focus() } catch (err) {}
        }
      }

      var onToggleMotion = function (e) {
        stop(e)
        var viewer = viewerRef.current
        if (viewer) viewer.setMotionMode(!motionOn)
        setMenu(false)
        focusCanvas()
      }

      var onExplode = function (e) {
        var viewer = viewerRef.current
        var value = Number(e && e.target ? e.target.value : 0)
        if (viewer) viewer.setExplode(isFinite(value) ? value / 100 : 0, false)
      }

      var onPlayExplode = function (e) {
        stop(e)
        var viewer = viewerRef.current
        if (viewer) viewer.playExplode()
        focusCanvas()
      }

      var onSelectPart = function (index) {
        return function (e) {
          stop(e)
          var viewer = viewerRef.current
          if (viewer) viewer.selectPart(motion.selected === index ? -1 : index)
        }
      }

      var onPartAxis = function (e) {
        var viewer = viewerRef.current
        var raw = e && e.target ? String(e.target.value) : 'auto'
        var axis = raw === 'auto' ? -1 : Number(raw)
        if (viewer && motion.selected >= 0) viewer.setPartAxis(motion.selected, axis)
      }

      var onPartSpeed = function (e) {
        var viewer = viewerRef.current
        var value = Number(e && e.target ? e.target.value : 0)
        if (viewer && motion.selected >= 0) viewer.setPartSpin(motion.selected, isFinite(value) ? value / 60 : 0)
      }

      var onToggleCouple = function (e) {
        stop(e)
        var viewer = viewerRef.current
        if (viewer) viewer.setCoupled(!motion.coupled)
        focusCanvas()
      }

      var onPartTeeth = function (e) {
        var viewer = viewerRef.current
        var value = Number(e && e.target ? e.target.value : 0)
        if (viewer && motion.selected >= 0) viewer.setPartTeeth(motion.selected, isFinite(value) ? value : 0)
      }

      var onResetMotion = function (e) {
        stop(e)
        var viewer = viewerRef.current
        if (viewer) viewer.resetMotion()
        focusCanvas()
      }

      var selectedPart = motion.selected >= 0 && motion.parts[motion.selected] ? motion.parts[motion.selected] : null
      var gearPairs = motion.gears && motion.gears.pairs ? motion.gears.pairs : []
      var pairCount = gearPairs.length
      // 传动比文字：优先显示选中那个零件与邻居的那一对，否则显示最大的一对
      var ratioText = ''
      if (pairCount) {
        var bestPair = null
        if (motion.selected >= 0) {
          for (var gp = 0; gp < gearPairs.length; gp++) {
            if (gearPairs[gp].a === motion.selected || gearPairs[gp].b === motion.selected) {
              bestPair = gearPairs[gp]
              break
            }
          }
        }
        if (!bestPair) {
          bestPair = gearPairs[0]
          for (var gq = 1; gq < gearPairs.length; gq++) {
            if (gearPairs[gq].ratio > bestPair.ratio) bestPair = gearPairs[gq]
          }
        }
        var r0 = bestPair.ratio >= 1 ? bestPair.ratio : 1 / bestPair.ratio
        ratioText = '1 : ' + (r0 >= 10 ? r0.toFixed(1) : r0.toFixed(2))
      }

      var motionPanel = motionOn ? h('div', { key: 'motion', style: MOTION_STYLE, className: 'dsh-stl-motion' },
        h('div', { key: 'title', style: MOTION_TITLE_STYLE },
          h('span', { key: 'l' }, t('motion') + ' · ' + motion.parts.length + ' ' + t('parts')),
          h('button', {
            key: 'reset',
            type: 'button',
            style: merge(BUTTON_STYLE, { height: '20px', padding: '0 6px', fontSize: '10px' }),
            onClick: onResetMotion
          }, t('motionReset'))),
        h('div', { key: 'explode', style: MOTION_ROW_STYLE },
          h('span', { key: 'l', style: MOTION_LABEL_STYLE }, t('explode')),
          h('input', {
            key: 'r',
            type: 'range',
            min: '0',
            max: '100',
            step: '1',
            value: String(Math.round(motion.explode * 100)),
            style: MOTION_RANGE_STYLE,
            className: 'dsh-stl-explode',
            onInput: onExplode,
            onChange: onExplode
          }),
          h('button', {
            key: 'p',
            type: 'button',
            style: merge(BUTTON_STYLE, { height: '20px', padding: '0 6px', fontSize: '10px' }),
            onClick: onPlayExplode
          }, motion.explode > 0.5 ? t('explodeStop') : t('explodePlay'))),
        motion.parts.length > 0
          ? h('div', { key: 'list', style: MOTION_LIST_STYLE },
            motion.parts.map(function (part) {
              return h('button', {
                type: 'button',
                key: 'part-' + part.index,
                className: 'dsh-stl-part',
                title: part.name || '',
                style: part.selected ? merge(MOTION_PART_STYLE, MOTION_PART_ON_STYLE) : MOTION_PART_STYLE,
                onClick: onSelectPart(part.index)
              },
                h('span', { key: 'n' }, t('part') + ' ' + (part.index + 1)),
                part.spinning ? h('span', { key: 'd', style: MOTION_DOT_STYLE }) : null)
            }))
          : null,
        pairCount > 0
          ? h('div', { key: 'couple', style: MOTION_ROW_STYLE },
            h('span', { key: 'l', style: MOTION_LABEL_STYLE }, t('couple')),
            h('button', {
              key: 'b',
              type: 'button',
              style: motion.coupled ? MOTION_TOGGLE_ON_STYLE : MOTION_TOGGLE_STYLE,
              'aria-pressed': motion.coupled ? 'true' : 'false',
              title: t('couple'),
              onClick: onToggleCouple
            }, motion.coupled ? t('coupleOn') : t('coupleOff')),
            ratioText ? h('span', { key: 'r', style: MOTION_RATIO_STYLE }, ratioText) : null)
          : null,
        selectedPart && pairCount > 0
          ? h('div', { key: 'teeth', style: MOTION_ROW_STYLE },
            h('span', { key: 'l', style: MOTION_LABEL_STYLE }, t('teeth')),
            h('input', {
              key: 'i',
              type: 'number',
              min: 0,
              step: 1,
              value: selectedPart.teeth > 0 ? String(selectedPart.teeth) : '',
              placeholder: t('partAuto'),
              className: 'dsh-stl-teeth',
              style: MOTION_INPUT_STYLE,
              onChange: onPartTeeth
            }))
          : null,
        motion.parts.length < 2 ? h('div', { key: 'single', style: MOTION_HINT_STYLE }, t('motionSingle')) : null,
        selectedPart ? h('div', { key: 'sel', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          h('div', { key: 'axis', style: MOTION_ROW_STYLE },
            h('span', { key: 'l', style: MOTION_LABEL_STYLE }, t('axisLabel')),
            h('select', {
              key: 's',
              style: merge(BUTTON_STYLE, { height: '20px', padding: '0 4px', fontSize: '10px', flex: '1' }),
              value: selectedPart.axis >= 0 ? String(selectedPart.axis) : 'auto',
              className: 'dsh-stl-axis-pick',
              onChange: onPartAxis
            },
              h('option', { key: 'auto', value: 'auto' }, t('partAuto')),
              h('option', { key: 'x', value: '0' }, 'X'),
              h('option', { key: 'y', value: '1' }, 'Y'),
              h('option', { key: 'z', value: '2' }, 'Z'))),
          h('div', { key: 'speed', style: MOTION_ROW_STYLE },
            h('span', { key: 'l', style: MOTION_LABEL_STYLE }, t('speed')),
            h('input', {
              key: 'r',
              type: 'range',
              min: '-120',
              max: '120',
              step: '5',
              value: String(Math.round(selectedPart.speed * 60)),
              style: MOTION_RANGE_STYLE,
              className: 'dsh-stl-speed',
              onInput: onPartSpeed,
              onChange: onPartSpeed
            }),
            h('span', { key: 'v', style: { minWidth: '42px', textAlign: 'right', fontSize: '10px', opacity: 0.7 } },
              Math.round(selectedPart.speed * 60) + ' ' + t('speedUnit'))))
          : null)
        : null

      var onView = function (name) {
        var viewer = viewerRef.current
        if (viewer) viewer.setView(name)
        setMenu(false)
        focusCanvas()
      }

      var onToggleWire = function (e) {
        stop(e)
        var viewer = viewerRef.current
        if (viewer) viewer.setWire(!wireOn)
        setMenu(false)
        focusCanvas()
      }

      var onToggleSpin = function (e) {
        stop(e)
        var viewer = viewerRef.current
        if (viewer) viewer.setSpin(!spinOn)
        setMenu(false)
        focusCanvas()
      }

      var onToggleAxis = function (e) {
        stop(e)
        var viewer = viewerRef.current
        if (viewer) viewer.setShowAxis(!axisOn)
        setMenu(false)
        focusCanvas()
      }

      var onToggleLang = function (e) {
        stop(e)
        setLang(uiLang === 'zh' ? 'en' : 'zh')
        setMenu(false)
        focusCanvas()
      }

      var onSave = function (e) {
        stop(e)
        var viewer = viewerRef.current
        var url = viewer ? viewer.snapshot() : null
        setMenu(false)
        focusCanvas()
        if (!url) return
        var base = String(filePath || 'model').replace(/\\/g, '/').split('/').pop()
        base = base.replace(/\.[^.]+$/, '') || 'model'
        try {
          var link = document.createElement('a')
          link.href = url
          link.download = base + '.png'
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
        } catch (err) {
          console.warn('[dsh-stl-viewer] save image failed', err)
        }
      }

      var menuRow = function (name, label, keyText) {
        return h('button', {
          type: 'button',
          key: 'row-' + name,
          style: MENU_ITEM_STYLE,
          onClick: function (e) { stop(e); onView(name) }
        },
          h('span', { key: 'l' }, label),
          h('span', { key: 'k', style: MENU_KEY_STYLE }, keyText))
      }

      var helpRows = t('helpRows')
      if (!Array.isArray(helpRows)) helpRows = []

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
                key: 'motion',
                style: motionOn ? merge(BUTTON_STYLE, BUTTON_ON_STYLE) : BUTTON_STYLE,
                'aria-pressed': motionOn ? 'true' : 'false',
                title: t('motion'),
                onClick: onToggleMotion
              }, t('motion')),
              h('button', {
                type: 'button',
                key: 'views',
                style: menu ? merge(BUTTON_STYLE, BUTTON_ON_STYLE) : BUTTON_STYLE,
                'aria-expanded': menu ? 'true' : 'false',
                title: t('views'),
                onClick: function (e) { stop(e); setMenu(!menu) }
              }, t('views') + ' ▾'),
              h('button', {
                type: 'button',
                key: 'reset',
                style: BUTTON_STYLE,
                title: t('reset') + ' (R)',
                onClick: onReset
              }, t('reset')))
          : null,
        menu && phase === 'ready'
          ? h('div', {
              key: 'menu-backdrop',
              style: MENU_BACKDROP_STYLE,
              onClick: function () { setMenu(false); focusCanvas() }
            })
          : null,
        phase === 'ready' ? motionPanel : null,
        menu && phase === 'ready'
          ? h('div', { key: 'menu', style: MENU_STYLE, className: 'dsh-stl-menu' },
              menuRow('front', t('viewFront'), '1'),
              menuRow('top', t('viewTop'), '2'),
              menuRow('right', t('viewRight'), '3'),
              menuRow('iso', t('viewIso'), '4'),
              h('div', { key: 'split-1', style: MENU_SPLIT_STYLE }),
              h('button', {
                type: 'button',
                key: 'wire',
                style: wireOn ? merge(MENU_ITEM_STYLE, MENU_ITEM_ON_STYLE) : MENU_ITEM_STYLE,
                onClick: onToggleWire
              },
                h('span', { key: 'l' }, t('wire')),
                h('span', { key: 'k', style: MENU_KEY_STYLE }, wireOn ? 'W ✓' : 'W')),
              h('button', {
                type: 'button',
                key: 'spin',
                style: spinOn ? merge(MENU_ITEM_STYLE, MENU_ITEM_ON_STYLE) : MENU_ITEM_STYLE,
                onClick: onToggleSpin
              },
                h('span', { key: 'l' }, t('spin')),
                h('span', { key: 'k', style: MENU_KEY_STYLE }, spinOn ? 'A ✓' : 'A')),
              h('button', {
                type: 'button',
                key: 'axes',
                style: axisOn ? merge(MENU_ITEM_STYLE, MENU_ITEM_ON_STYLE) : MENU_ITEM_STYLE,
                onClick: onToggleAxis
              },
                h('span', { key: 'l' }, t('axes')),
                h('span', { key: 'k', style: MENU_KEY_STYLE }, axisOn ? 'G ✓' : 'G')),
              h('button', {
                type: 'button',
                key: 'save',
                style: MENU_ITEM_STYLE,
                onClick: onSave
              },
                h('span', { key: 'l' }, t('save')),
                h('span', { key: 'k', style: MENU_KEY_STYLE }, 'PNG')),
              h('div', { key: 'split-2', style: MENU_SPLIT_STYLE }),
              h('button', {
                type: 'button',
                key: 'help',
                style: MENU_ITEM_STYLE,
                onClick: function (e) { stop(e); setMenu(false); setHelp(true) }
              },
                h('span', { key: 'l' }, t('help')),
                h('span', { key: 'k', style: MENU_KEY_STYLE }, '?')),
              h('div', { key: 'split-3', style: MENU_SPLIT_STYLE }),
              h('button', {
                type: 'button',
                key: 'lang',
                style: MENU_ITEM_STYLE,
                onClick: onToggleLang
              },
                h('span', { key: 'l' }, t('language')),
                h('span', { key: 'k', style: MENU_KEY_STYLE }, uiLang === 'zh' ? '中文' : 'EN')))
          : null,
        help && phase === 'ready'
          ? h('div', {
              key: 'help',
              style: HELP_STYLE,
              className: 'dsh-stl-help',
              onClick: function () { setHelp(false); focusCanvas() }
            },
              h('div', { style: HELP_CARD_STYLE },
                h('div', { style: HELP_TITLE_STYLE }, t('help')),
                helpRows.map(function (line, i) {
                  return h('div', { key: 'help-' + i, style: HELP_ROW_STYLE }, line)
                })))
          : null,
        h('div', {
          key: 'panel',
          ref: panelRef,
          style: PANEL_STYLE,
          className: 'dsh-stl-panel',
          'aria-live': 'polite'
        }),
        h('svg', {
          key: 'axis',
          ref: axisRef,
          viewBox: '0 0 60 60',
          width: 60,
          height: 60,
          style: AXIS_STYLE,
          className: 'dsh-stl-axis',
          'aria-hidden': 'true'
        }),
        h('div', { key: 'label', ref: labelRef, style: LABEL_STYLE, className: 'dsh-stl-label' },
          h('span', { key: 'dist', ref: distRef, style: LABEL_DIST_STYLE }),
          h('span', { key: 'mode', ref: modeRef, style: LABEL_MODE_STYLE }),
          h('span', { key: 'delta', ref: deltaRef, style: LABEL_DELTA_STYLE })),
        phase === 'ready'
          ? h('div', { key: 'stats', style: STATS_STYLE, className: 'dsh-stl-stats' },
              h('div', { key: 'line-1' },
                thousands(stats ? stats.triangles : 0) + ' ' + t('triangles') +
                (stats ? ' · ' + t('size') + ' ' +
                  fmtDim(stats.dims[0]) + ' × ' + fmtDim(stats.dims[1]) + ' × ' + fmtDim(stats.dims[2]) : '')),
              stats && stats.info
                ? h('div', { key: 'line-2' },
                    t('volume') + ' ' + fmtDim(stats.info.volume / 1000) + ' cm³ · ' +
                    t('area') + ' ' + fmtDim(stats.info.area / 100) + ' cm²' +
                    (stats.info.closed ? '' : ' · ' + t('notClosed')))
                : null)
          : null,
        phase === 'ready'
          ? h('div', { key: 'hint', style: HINT_STYLE, className: 'dsh-stl-hint' },
              !measuring ? (motionOn ? t('motionHint') : t('hint')) : pickCount === 1 ? t('pickSecond') : t('measureHint'))
          : null,
        phase === 'converting'
          ? h('div', { key: 'converting', style: OVERLAY_STYLE, className: 'dsh-stl-converting' },
              h('div', { style: ERROR_TEXT_STYLE },
                t('converting') + ' · ' + progress.toFixed(1) + ' s'),
              h('div', { style: CONVERT_HINT_STYLE }, t('convertingHint')),
              h('button', { type: 'button', style: BUTTON_STYLE, onClick: onCancel }, t('cancel')))
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
        exts: ['stl', 'step', 'stp', 'iges', 'igs', 'brep'],
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
              exts: ['stl', 'step', 'stp', 'iges', 'igs', 'brep'],
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
      inject: ['betterSidebar'],
      apply: apply,
      // 只给测试用：几何函数是纯函数，单测比截图快得多
      __internals: {
        traceLoop: traceLoop,
        fitCirclePoints: fitCirclePoints,
        circleFromEdge: circleFromEdge,
        regionCircles: regionCircles,
        growSmooth: growSmooth,
        wallCircle: wallCircle,
        buildEdgeMap: buildEdgeMap,
        parseStl: parseStl,
        decodeMesh: decodeMesh,
        stepMesh: stepMesh,
        isStepPath: isStepPath,
        describeParts: describeParts,
      describeGears: describeGears,
        meshInfo: meshInfo,
        finalizeMesh: finalizeMesh,
        facePlane: facePlane,
        closestPointOnTri: closestPointOnTri,
        closestSegments: closestSegments,
        qAxisAngle: qAxisAngle,
        qMultiply: qMultiply,
        qRotate: qRotate,
        camBasis: camBasis,
        MODEL_AXES: MODEL_AXES,
        detectLang: detectLang,
        getLang: getLang,
        setLang: setLang,
        LANG_KEY: LANG_KEY,
        FONT_UI: FONT_UI,
        triTriDistance: triTriDistance,
        buildFeatureTopology: buildFeatureTopology,
        coordKey: coordKey,
        closestPointOnSegment: closestPointOnSegment,
        pointPlane: pointPlane,
        segmentAngleDeg: segmentAngleDeg,
        segmentGap2D: segmentGap2D
      }
    }
  }
})
