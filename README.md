# dsh-stl-viewer

An **STL 3D preview** for the [DeepSeek Harness](https://github.com/deepseek-ai/dsh) side card.
Click any `.stl` in the [dsh-better-sidebar](https://github.com/H-h-Hh/dsh-better-sidebar) file tree
and the file renders in place, with the controls of a normal 3D viewer.

```
left-drag     orbit around the model
wheel         zoom
right-drag    pan (Shift + left-drag does the same; two-finger scroll zooms)
double-click  reset the view (the 复位视角 button and the R / 0 keys do too)

measure       click 测量 (or press M), then click two features — the cursor snaps to a
              vertex, an edge, a whole face or a circular rim, the way Bambu Studio's
              measure tool does. Shift-click takes an arbitrary point on the surface
              instead. Dragging still orbits, Esc or 测量 again leaves the mode
```

<p align="center">
  <img src="docs/preview/preview_sidebar.jpg" width="100%" alt="A 47,068-triangle gear cover rendered in the DSH side card">
</p>

<p align="center"><sub>A 47,068-triangle gear cover (176 × 176 × 40 mm) in the real side card, next to the chat that produced it.</sub></p>

<p align="center">
  <img src="docs/preview/preview_case.jpg" width="49%" alt="3D printed enclosure lid">
  <img src="docs/preview/preview_stencil.jpg" width="49%" alt="PCB solder-paste stencil">
</p>

<p align="center"><sub>No viewer installed: “此文件类型不支持预览 / 下载查看”. With the plugin: a 2,912-triangle enclosure lid and a 17,136-triangle stencil, both in the side card.</sub></p>

<p align="center">
  <img src="docs/preview/preview_points.jpg" width="100%" alt="Two snapped corners on a plate, reading 58.0 mm point to point">
</p>

<p align="center"><sub>点到点: the cursor snaps to the corner you are aiming at, the picked point is drawn
as a dot on the model, and the readout carries the straight distance plus ΔX / ΔY / ΔZ: 58.0 mm
across the diagonal of a plate, the two farthest corners the test could find.</sub></p>

<p align="center">
  <img src="docs/preview/preview_faces.jpg" width="100%" alt="Two parallel plates highlighted, reading 36.0 mm face to face">
</p>

<p align="center"><sub>面到面: click one face, then another. Coplanar triangles are flood-filled from the
picked one, so you measure a real face — not one triangle — and two parallel faces give the
gap between them: 36.0 mm here, with ΔX / ΔY / ΔZ underneath.</sub></p>

<p align="center">
  <img src="docs/preview/preview_circle.jpg" width="100%" alt="The inner rim of a washer picked as one circle, reading Ø 20.0 mm and R 10.0 mm in the corner panel">
</p>

<p align="center"><sub>圆: hover a rim and the whole rim is one pick — here the 20 mm bore of a
washer, with the 40 mm outer rim available as a second, separate pick. The panel in the
top-left corner gives Ø and R (and, while measuring, the pair type plus ΔX / ΔY / ΔZ), the
way Bambu Studio does it.</sub></p>

> **Why a separate plugin?**
> DeepSeek Harness ships previews for text, images, PDFs and Markdown. Binary CAD
> formats such as `.stl`, `.obj`, `.step` fall through to “this file type cannot be
> previewed”. This plugin registers an `stl` file viewer on the `betterSidebar`
> service, so `.stl` stops being an opaque blob.

## Features

- **Binary and ASCII STL** — sniffed, not guessed from the extension: exact `84 + 50·N`
  size match first, then an ASCII scan, then a tolerant binary pass for files with
  trailing bytes
- **Correct normals** — recomputed per facet; STLs in the wild carry zeroed or
  plainly wrong normals, and exported meshes often mix winding orders
- **Two-sided shading** — `gl_FrontFacing` flips the normal, so inverted facets still read
  as solid rather than a black hole
- **Z-up → Y-up** — CAD and 3D printing export Z-up; the viewer stands models upright
  instead of showing them lying on their back
- **Frame-fit camera** — the orbit distance is derived from the bounding sphere and the
  FOV, so a 0.6 mm thick stencil and a 300 mm part both fill the panel on open
- **Measure the way a CAD tool does** — the pointer snaps to a **vertex**, an **edge** or a
  whole **face**, like [Bambu Studio's measure tool](https://wiki.bambulab.com/en/software/bambu-studio/measure):
  corners within 12 px win over edges within 8 px, which win over the face underneath, and
  Shift-click takes an arbitrary point instead. Only real creases snap (boundary edges, or
  neighbours more than 20° apart), so a finely tessellated cylinder does not turn into a
  field of snapping edges. The pair decides what is measured — point/point is the straight
  distance, point/face the perpendicular distance, edge/edge the angle plus the gap,
  face/face the plane gap when parallel and the true shortest distance plus the angle when
  not — and every readout carries ΔX / ΔY / ΔZ. Picking is a ray–triangle intersection
  against the real mesh, and the numbers come from the raw file coordinates rather than the
  normalised render space, so they are the same numbers you would measure in CAD
- **Circles are picked as circles** — a rim on a bore, a boss or a cylinder is a chain of very
  short creases, and edge snapping alone would only ever catch one facet of it. Hovering a
  rim therefore traces the loop and fits a circle to it, which turns the whole rim into a
  single pick: the 20 mm bore and the 40 mm outside of a washer are two separate features, so
  an inner and an outer diameter can be read on their own. Clicking **inside** the hole works
  the same way — the bore wall is one smooth region whose boundary is that circle, so you do
  not have to land on the rim itself. The fit rejects what is not round (a hexagon is not a
  circle) and a chain that does not close
- **A readout panel in the corner** — the picks are listed in the top-left corner the way
  Bambu Studio does it: `直径 Ø 20.0 mm` and `半径 R 10.0 mm` for a circle, the pair type and
  the distance for a measurement, with ΔX / ΔY / ΔZ underneath
- **Themed** — transparent clear colour and `currentColor` chrome, so the panel follows
  the app's dark/light theme instead of stamping a white box on it
- **No build step, no dependencies** — `lib/client.js` *is* the artifact

## Requirements

- DeepSeek Harness `>= 0.2.0`
- [dsh-better-sidebar](https://github.com/H-h-Hh/dsh-better-sidebar) `>= 0.30.0` — it owns
  the file tree, the tabs and the `betterSidebar` service this plugin registers into
- A browser with WebGL 1 (everything current; the software rasteriser is enough)

## Install

In DSH, or from the plugin manager page → *install from a local directory*:

```
plugin_manager install_bundle  target: file:D:/path/to/dsh-stl-viewer
```

Then reload the page. Open any `.stl` from the file tree; if the file is already open in
a tab as an unsupported binary, close that tab and click the file again.

Uninstall:

```
plugin_manager remove_bundle  target: dsh-stl-viewer
```

## How it works

The plugin is a bundle with a host half and a client half.

| half | file | what it does |
| --- | --- | --- |
| host | `lib/index.js` | an empty Cordis plugin — it exists so the package enters the layer stack and its client script is served |
| manifest | `package.json` | `dsh.bundle.patch` makes it a bundle, `exports["./client"]` + `dsh.client.platform: "web"` publish `/plugins/dsh-stl-viewer/client.js` |
| patch | `cordis.patch.yml` | the one `insert:` line that puts the plugin in the layer stack |
| client | `lib/client.js` | parse → normalise → WebGL → input → registration; a classic script, run by the DSH module loader, `require('react')` resolving to the host's React |

Registration is one call, and the model bytes come from the sidebar's own route:

```js
ctx.betterSidebar.registerFileViewer({
  id: 'dsh-stl-viewer:stl',
  title: () => t('title'),
  icon: (size) => cubeIcon(size),
  exts: ['stl'],
  priority: 10,
  fetchStrategy: 'mediaUrl',   // the host hands over the raw-bytes URL
  component: StlViewer
})
```

`fetchStrategy: 'mediaUrl'` means the viewer gets `mediaUrl` as a prop and does a plain
`fetch()`, so no host RPC, no base64 over the wire. Everything after that is local:

| step | detail |
| --- | --- |
| read | `fetch(mediaUrl, { credentials: 'same-origin' })` → `ArrayBuffer` |
| parse | 80-byte header + `uint32` count + 50 bytes/facet, or `vertex x y z` triples (ASCII capped at 6 M numbers) |
| normalise | centre on the bbox, scale to a max edge of 2, per-facet normals, Z-up → Y-up |
| render | WebGL 1, three lights + specular, one `drawArrays`, redraws only on demand |

The plugin also registers a cube file icon for `.stl`, so the file tree stops showing a
generic blob.

## Notes and limits

- **Sizes carry no unit.** STL stores bare numbers; the `size X × Y × Z` readout is the
  raw bounding box, not mm or inch.
- **Measurements say `mm`, because CAD STL almost always is.** The number is the raw
  coordinate distance in the file; if your model is authored in inches, read it as inches.
- **"A face" is a coplanar region, found by flood fill.** Curved surfaces are therefore many
  faces, which is what you want when measuring a flat pad against a plate, but a fillet is
  not a single face. Faces are grown along shared edges only, so a mesh with welded
  vertices gives the best regions.
- **Snapping needs the crease topology, which is built on first use.** Finding corners and
  creases means an edge sweep over the mesh — 0.6 s for 47 k facets — so it happens the first
  time you hover in measure mode instead of when the file opens. Meshes above 400 k facets
  skip it and fall back to face picking.
- **A circle is recognised, not assumed.** The rim must close (no turn sharper than 60° per
  step) and fit a circle within 2% of its radius, checked at the vertices, at the midpoint of
  every segment and against the rim plane — a 48-sided bore reads as round, a hexagon does not.
  Circles ride on the same crease topology as snapping, so they also wait for that first hover.
  The wall of a hole is treated as a circle too: it is grown as one smooth patch (across every
  edge that is not a crease), and its boundary has to be a circle whose axis the patch's own
  facets face sideways; a flat disc has both boundaries round but faces along the axis, so it
  stays a face
- **Z-up is assumed.** Models authored Y-up will lie on their side. Axis guessing is
  deliberately left out — a wrong guess is more confusing than a predictable default.
- **Large files are parsed whole.** A few hundred thousand facets take 1–2 s and one
  `drawArrays` call; there is no streaming and no LOD.
- **STL only.** `.obj`, `.glb`, `.3mf` are out of scope.
- **No WebGL → a message, not a white panel.**

## Tests

```bash
node --check lib/client.js
node test/smoke.cjs
```

`test/smoke.cjs` runs `lib/client.js` in a `vm` sandbox with a minimal React hooks stub and
a replaceable `fetch`, and asserts the module contract, the viewer descriptor, a
hand-built binary cube (12 facets, size 20), an ASCII single triangle, the three
error paths (garbage bytes, empty file, failed fetch), the face-to-face geometry —
plane fitting, point-to-triangle and triangle-to-triangle distance — and the feature
topology: 8 corners and exactly 12 creases on a cube (the 6 in-plane diagonals do not
count), plus point/segment/plane helpers. The circle fit gets its own group: a 24-gon traces
back to its start and fits r = 10, a hexagon, a square and an open chain are all rejected,
and a washer fixture yields exactly two rims, R10 and R20. No browser needed.
`.github/workflows/test.yml` runs the same on every push.

The end-to-end check uses a real renderer: `test/harness.html` mounts the component with
React UMD builds, `test/shoot.cjs` screenshots it through a headless Electron
(`--enable-unsafe-swiftshader --use-gl=swiftshader`). That is how the images above
were produced.

`test/measure.cjs` drives the same harness with synthetic pointer events: it looks up the
screen pixels of the two plate faces through the viewer's `_test` handle, clicks 测量,
clicks both faces, and asserts the label reads `36.0 mm` with `面到面 · 平行面间距`, that
`_test.measure().parallel` is true, and that Esc clears everything again. The fixture
`test/fixtures/plates.stl` comes from `test/fixtures/make-plates.cjs`: two 80 x 60 mm
plates 36 mm apart, the top one covering half of the bottom one. The same fixture doubles as
the snapping check: `test/snap-points.cjs` scans the canvas for pixels that snap to a
`point`, picks the two farthest apart and asserts the label reads `58.0 mm` — the diagonal of
the top plate — with ΔX 40 / ΔY 0 / ΔZ 42.

`test/circle.cjs` covers the rims, on a washer made by `test/fixtures/make-ring.cjs` (Ø40
outside, Ø20 bore, 6 mm thick, 48 segments, normals written as zero so the plugin has to
recompute them). It sweeps the canvas through `_test.pickFeature`, keeps the pixels that snap
to a circle and asserts there are exactly two of them, then clicks the bore and reads the
corner panel: `直径 Ø 20.0 mm` and `半径 R 10.0 mm`.

```bash
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS <electron> test/measure.cjs \
  "test/harness.html?file=./fixtures/plates.stl" out.png
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS <electron> test/snap-points.cjs \
  "test/harness.html?file=./fixtures/plates.stl" out.png
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS <electron> test/circle.cjs \
  "test/harness.html?file=./fixtures/ring.stl" out.png
```

## 中文速览

给 DSH 侧边栏加一个 **STL 三维预览**：文件树里点开 `.stl`，右侧面板直接渲染，交互同常规 3D 看图。

```bash
plugin_manager install_bundle  target: file:D:/path/to/dsh-stl-viewer
```

- 左键旋转 / 滚轮缩放 / 右键平移 / 双击复位（`R`、`0` 也复位）
- 点「测量」（或按 `M`）后光标会像 Bambu Studio 那样吸附到**顶点 / 棱 / 面 / 圆**：两个点的直线距离、点到面的垂直距离、两棱的夹角与间距、两面平行取间距、不平行取夹角 + 最短距离、圆心距等，读数都带 ΔX/ΔY/ΔZ；`Shift` + 点击取任意表面点；拖动仍可旋转，`Esc` 退出
- 悬停圆孔/圆柱的边一圈即整圈选中，**内径与外径是两个独立的圆**可分别点；左上角面板显示 `直径 Ø` 与 `半径 R`，和 Bambu Studio 的读数面板一致
- 二进制与 ASCII STL 都能读；法线逐面重算、双面打光，Z-up 自动立起来
- 相机按包围球自适应，0.6 mm 的钢网和 300 mm 的零件都会铺满面板
- 依赖 dsh-better-sidebar ≥ 0.30.0；没有构建步骤，`lib/client.js` 就是产物

尺寸没有单位（STL 不存单位），大文件整体解析（几十万面约 1–2 秒），`.obj/.glb/.3mf` 不在范围内。

## License

MIT — see [LICENSE](LICENSE).
