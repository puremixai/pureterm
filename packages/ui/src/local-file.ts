/*
 * 本地文件的进出口。
 *
 * 单独一个模块，因为它和「远端文件」正好是一对：SFTP 的两端各有一个「本地」和
 * 一个「远端」。这里只管**本机**这一头，而且只用浏览器就有的 API。
 *
 * 为什么不用 Electron 的系统文件对话框（像选私钥那样）：那样在 Web 载体下会把文件
 * 落到**后端那台机器**上——用户可能正坐在另一台机器前用浏览器，他要的是文件到他手里。
 * 用 Blob 的话桌面端和浏览器端走的是同一条路（浏览器里就是普通的「下载」），
 * 渲染层的这份产物一个字都不用分叉。
 */

/**
 * 把拿到的字节存成本地文件。
 *
 * 用 `URL.createObjectURL` 而不是 data: URL：后者要把整份内容再编码一遍塞进 DOM 属性，
 * 4 MiB 的文件会变成 5 MiB 的 Base64 字符串，还要在 DOM 里待着。
 */
export function saveBytes(bytes: Uint8Array, filename: string): void {
  // 先复制一份再交给 Blob：这块 buffer 是从传输层解出来的，可能还带着视图，
  // 而我们不该让一个下载持有它的引用。
  const blob = new Blob([bytes.slice()], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  // 必须挂进文档再点：脱离文档的 <a> 在部分实现里 click() 不生效
  document.body.append(link)
  link.click()
  link.remove()
  // **不能**点完立刻 revoke：下载是异步开始的，撤得太快会把这一次撤掉。
  // 内容已经在内存里，一秒足够它起步，之后留着这个 URL 只是占内存。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 读一个本地文件成字节。
 *
 * 用 `File.arrayBuffer()` 而不是 `FileReader`：前者是 Promise，给的就是 ArrayBuffer，
 * 少一层事件回调。这里**不做任何编码转换**——上传的可能是图片、压缩包，按 UTF-8
 * 解一次就坏了，而坏掉的二进制通常还是「能打开」的，只是内容不对。
 */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}
