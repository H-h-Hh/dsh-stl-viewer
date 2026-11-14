/**
 * dsh-stl-viewer — 宿主半侧（Node / DSH 服务进程）。
 *
 * 本插件没有任何服务端逻辑：STL 字节由 dsh-better-sidebar 的 mediaUrl 路由
 * 直接喂给浏览器，解析与渲染全部在客户端半侧（lib/client.js）里完成。
 * 这里只提供一个合法的 cordis 插件入口，让 loader 能把本包裹进层栈，
 * 从而让 DSH 模块系统按 package.json 的 exports["./client"] 提供
 * /plugins/dsh-stl-viewer/client.js。
 */

export const name = 'dsh-stl-viewer'

/** 无宿主逻辑。 */
export function apply() {}
