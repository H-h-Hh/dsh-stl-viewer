/**
 * 生成 test/fixtures/cube.step —— 20 mm 立方体，ISO-10303-21（AP214）。
 *
 * 每个面自带一份顶点与棱（拓扑上是六个独立的壳），而不是共享 8 顶点 12 棱。
 * 试过共享写法：OCCT 会把实体读成六个"无界平面"，三角化出来的三角形互相穿插，
 * 体积算出来是 0。一棱一份的写法反而稳：六个壳各两块三角面，合起来正好是
 * 一个 20 mm 立方体，体积 8000 mm³。夹具要的是几何确定，不是漂亮的拓扑。
 *
 * 用法：node test/fixtures/make-step.cjs
 */
const fs = require('fs')
const path = require('path')

const SIZE = 20

/** 六个面：法线决定绕向（从外面看逆时针），loop 是四个角的坐标。 */
const FACES = [
  { normal: [1, 0, 0], loop: [[20, 0, 0], [20, 20, 0], [20, 20, 20], [20, 0, 20]] },
  { normal: [-1, 0, 0], loop: [[0, 0, 0], [0, 0, 20], [0, 20, 20], [0, 20, 0]] },
  { normal: [0, 1, 0], loop: [[0, 20, 0], [0, 20, 20], [20, 20, 20], [20, 20, 0]] },
  { normal: [0, -1, 0], loop: [[0, 0, 0], [20, 0, 0], [20, 0, 20], [0, 0, 20]] },
  { normal: [0, 0, 1], loop: [[0, 0, 20], [20, 0, 20], [20, 20, 20], [0, 20, 20]] },
  { normal: [0, 0, -1], loop: [[0, 0, 0], [0, 20, 0], [20, 20, 0], [20, 0, 0]] }
]

let next = 100
const id = () => '#' + next++
const lines = []
const emit = (text) => lines.push(text)

function num(v) {
  const s = Number(v).toFixed(6).replace(/0+$/, '')
  return s.endsWith('.') ? s + '0' : s
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function len(a) {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
}

function unit(a) {
  const l = len(a)
  return [a[0] / l, a[1] / l, a[2] / l]
}

function pointId(xyz) {
  const p = id()
  emit(`${p}=CARTESIAN_POINT('',(${xyz.map(num).join(',')}));`)
  return p
}

function directionId(xyz) {
  const d = id()
  emit(`${d}=DIRECTION('',(${xyz.map(num).join(',')}));`)
  return d
}

const faceIds = []

for (const face of FACES) {
  const loop = face.loop
  const edgeIds = []

  for (let i = 0; i < loop.length; i += 1) {
    const from = loop[i]
    const to = loop[(i + 1) % loop.length]
    const dir = unit(sub(to, from))

    const fromVertex = id()
    emit(`${fromVertex}=VERTEX_POINT('',${pointId(from)});`)
    const toVertex = id()
    emit(`${toVertex}=VERTEX_POINT('',${pointId(to)});`)

    const vector = id()
    emit(`${vector}=VECTOR('',${directionId(dir)},${num(len(sub(to, from)))});`)
    const line = id()
    emit(`${line}=LINE('',${pointId(from)},${vector});`)

    const curve = id()
    emit(`${curve}=EDGE_CURVE('',${fromVertex},${toVertex},${line},.T.);`)

    const oriented = id()
    emit(`${oriented}=ORIENTED_EDGE('',*,*,${curve},.T.);`)
    edgeIds.push(oriented)
  }

  const edgeLoop = id()
  emit(`${edgeLoop}=EDGE_LOOP('',(${edgeIds.join(',')}));`)
  const bound = id()
  emit(`${bound}=FACE_OUTER_BOUND('',${edgeLoop},.T.);`)

  const origin = loop[0]
  const refDir = unit(sub(loop[1], origin))
  const placement = id()
  emit(`${placement}=AXIS2_PLACEMENT_3D('',${pointId(origin)},${directionId(face.normal)},${directionId(refDir)});`)
  const plane = id()
  emit(`${plane}=PLANE('',${placement});`)

  const advanced = id()
  emit(`${advanced}=ADVANCED_FACE('',(${bound}),${plane},.T.);`)
  faceIds.push(advanced)
}

const shell = id()
emit(`${shell}=CLOSED_SHELL('',(${faceIds.join(',')}));`)
const brep = id()
emit(`${brep}=MANIFOLD_SOLID_BREP('cube',${shell});`)
const axis = id()
emit(`${axis}=AXIS2_PLACEMENT_3D('',#1,${directionId([0, 0, 1])},${directionId([1, 0, 0])});`)
const shapeRep = id()
emit(`${shapeRep}=ADVANCED_BREP_SHAPE_REPRESENTATION('cube',(${brep},${axis}),#76);`)

const body = [
  'ISO-10303-21;',
  'HEADER;',
  "FILE_DESCRIPTION(('dsh-stl-viewer test fixture'),'2;1');",
  "FILE_NAME('cube.step','2026-01-01T00:00:00',(''),(''),'dsh-stl-viewer','dsh-stl-viewer','');",
  "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
  'ENDSEC;',
  'DATA;',
  "#1=CARTESIAN_POINT('',(0.,0.,0.));",
  "#2=APPLICATION_CONTEXT('core data for automotive mechanical design processes');",
  "#3=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#2);",
  "#4=PRODUCT_CONTEXT('',#2,'mechanical');",
  "#5=PRODUCT('cube','cube','',(#4));",
  "#6=PRODUCT_DEFINITION_FORMATION('','',#5);",
  "#7=PRODUCT_DEFINITION_CONTEXT('part definition',#2,'design');",
  "#8=PRODUCT_DEFINITION('design','',#6,#7);",
  "#9=PRODUCT_DEFINITION_SHAPE('','',#8);",
  "#10=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));",
  "#11=(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.));",
  "#12=(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT());",
  '#76=(GEOMETRIC_REPRESENTATION_CONTEXT(3) ' +
    'GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#77)) GLOBAL_UNIT_ASSIGNED_CONTEXT((#10,#11,#12)) ' +
    "REPRESENTATION_CONTEXT('',''));",
  "#77=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#10,'distance_accuracy_value','');",
  ...lines,
  '#90=SHAPE_DEFINITION_REPRESENTATION(#9,' + shapeRep + ');',
  'ENDSEC;',
  'END-ISO-10303-21;',
  ''
].join('\n')

const out = path.join(__dirname, 'cube.step')
fs.writeFileSync(out, body)
console.log('wrote ' + out + ' (' + Buffer.byteLength(body) + ' B, ' + SIZE + ' mm cube)')
