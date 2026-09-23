/*
 * 只留「打包器需要知道的模块形状」。
 *
 * 早先这里把 HostRecord / SshApi / SmokeReport 等一整套领域类型又抄了一遍——
 * 那就等于给 shared/protocol.ts 造了一个会走形的影子：协议改了、这里忘了改，
 * 编译期一切正常，运行时对不上。现在这些类型只有一份，在 shared/protocol.ts，
 * `window.puretermDesktop` 的声明也跟着协议类型走（见 transport.ts 的 declare global）。
 */

declare module '*.css' {
  const content: string
  export default content
}
