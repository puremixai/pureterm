import { createReadStream, openSync, readSync, closeSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 最小 asar 读取器。
 *
 * asar 格式（无依赖可解，不必装 asar 包）：
 *   0  uint32  = 4（下面那个字段自己的长度）
 *   4  uint32  = headerSize（pickle 长度，= 8 + jsonLen 补齐到 4 字节）
 *   8  uint32  = jsonLen + 4
 *   12 uint32  = jsonLen
 *   16 .. 16+jsonLen  = 目录树的 JSON
 *   文件数据从 8 + headerSize 开始，按 header 里每个文件的 offset 定位
 */

const ASAR = process.argv[2]
const MODE = process.argv[3] ?? 'list'
const TARGET = process.argv[4]
const OUT = process.argv[5]

const fd = openSync(ASAR, 'r')
const head = Buffer.alloc(16)
readSync(fd, head, 0, 16, 0)
const headerSize = head.readUInt32LE(4)
const jsonLen = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(jsonLen)
readSync(fd, jsonBuf, 0, jsonLen, 16)
const tree = JSON.parse(jsonBuf.toString('utf8'))
const dataOffset = 8 + headerSize

/**
 * 取文件在数据区的偏移。
 *
 * 坑：asar 头里的 offset **可能是字符串**（大数值被序列化成字符串），
 * 只认 `typeof === 'number'` 会把几乎所有文件误判成 unpacked —— 表现为
 * grep 对已知存在的字符串也报 0 命中。真正「没有偏移」的才是 unpacked。
 */
function offsetOf(info) {
  if (info.offset === undefined || info.offset === null) return null
  const value = Number(info.offset)
  return Number.isFinite(value) ? value : null
}

/** 把目录树摊平成路径 → {size, offset} */
function flatten(node, prefix = '', out = new Map()) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const path = prefix ? `${prefix}/${name}` : name
    if (entry.files) flatten(entry, path, out)
    else out.set(path, { size: entry.size ?? 0, offset: entry.offset, unpacked: entry.unpacked })
  }
  return out
}

const files = flatten({ files: tree.files })

if (MODE === 'list') {
  const rows = [...files.entries()].map(([path, info]) => ({ path, ...info }))
  rows.sort((a, b) => b.size - a.size)
  console.log(`共 ${rows.length} 个条目\n`)
  console.log('=== 最大的 40 个 ===')
  for (const row of rows.slice(0, 40)) {
    console.log(`${(row.size / 1024 / 1024).toFixed(2).padStart(8)} MB  ${row.path}`)
  }
  console.log('\n=== 顶层结构（按体积聚合）===')
  const byTop = new Map()
  for (const row of rows) {
    const top = row.path.split('/').slice(0, 2).join('/')
    byTop.set(top, (byTop.get(top) ?? 0) + row.size)
  }
  for (const [top, size] of [...byTop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    console.log(`${(size / 1024 / 1024).toFixed(2).padStart(8)} MB  ${top}`)
  }
}

if (MODE === 'grep') {
  // 压缩后的 bundle 常常「整个文件一行」，按行打印没有意义。
  // 这里打印命中点前后各 CONTEXT 个字符的窗口，并支持第 5 个参数限定路径。
  const CONTEXT = Number(process.env.CONTEXT) || 260
  const pattern = new RegExp(TARGET, 'gi')
  const pathFilter = process.argv[5] ? new RegExp(process.argv[5], 'i') : null
  const skipExt = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|eot|mp3|mp4|wasm|node|dll|exe|so|dylib|zip|gz)$/i
  let total = 0
  outer: for (const [path, info] of files) {
    if (pathFilter && !pathFilter.test(path)) continue
    if (info.size > 12 * 1024 * 1024 || skipExt.test(path)) continue
    const off = offsetOf(info)
    if (off === null) continue
    const buf = Buffer.alloc(info.size)
    readSync(fd, buf, 0, info.size, dataOffset + off)
    const text = buf.toString('utf8')
    const seen = new Set()
    let match
    pattern.lastIndex = 0
    while ((match = pattern.exec(text)) !== null) {
      const start = Math.max(0, match.index - CONTEXT)
      const key = Math.floor(start / CONTEXT)
      if (seen.has(key)) continue
      seen.add(key)
      const snippet = text.slice(start, Math.min(text.length, match.index + CONTEXT))
      console.log(`\n--- ${path} @${match.index} ---\n${snippet}`)
      if (++total > 60) {
        console.log('\n…(命中上限 60)')
        break outer
      }
    }
  }
  console.log(`\n命中 ${total} 处`)
}

if (MODE === 'cat') {
  const info = files.get(TARGET)
  if (!info) {
    console.log(`没有 ${TARGET}`)
    process.exit(1)
  }
  if (info.unpacked) {
    console.log(`（unpacked，去 app.asar.unpacked 下读）`)
    process.exit(1)
  }
  const buf = Buffer.alloc(info.size)
  readSync(fd, buf, 0, info.size, dataOffset + offsetOf(info))
  if (OUT) {
    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, buf)
    console.log(`已写出 ${info.size} 字节 → ${OUT}`)
  } else {
    process.stdout.write(buf.toString('utf8'))
  }
}

if (MODE === 'extract') {
  // 把匹配的文件解出来，落到本地再用真正的检索工具搜。
  // （自己写的 in-asar grep 出过「对已知字符串也报 0 命中」的假阴性，不值得修。）
  const pattern = new RegExp(TARGET, 'i')
  let count = 0
  let bytes = 0
  for (const [path, info] of files) {
    if (!pattern.test(path)) continue
    const off = offsetOf(info)
    if (off === null) {
      console.log(`跳过（unpacked）${path}`)
      continue
    }
    const dest = join(OUT, path)
    mkdirSync(dirname(dest), { recursive: true })
    const buf = Buffer.alloc(info.size)
    readSync(fd, buf, 0, info.size, dataOffset + offsetOf(info))
    writeFileSync(dest, buf)
    count++
    bytes += info.size
  }
  console.log(`解出 ${count} 个文件，共 ${(bytes / 1024 / 1024).toFixed(2)} MB → ${OUT}`)
}

if (MODE === 'slice') {
  // 按字节区间取内容：压缩后的 bundle 里，一段连续区域往往就是一张完整的表
  const info = files.get(TARGET)
  if (!info) {
    console.log(`没有 ${TARGET}`)
    process.exit(1)
  }
  const start = Number(process.argv[5])
  const len = Number(process.argv[6])
  const off = offsetOf(info)
  const from = dataOffset + off + start
  const size = Math.min(len, info.size - start)
  const buf = Buffer.alloc(size)
  readSync(fd, buf, 0, size, from)
  process.stdout.write(buf.toString('utf8'))
}

if (MODE === 'find') {
  const pattern = new RegExp(TARGET, 'i')
  for (const [path, info] of files) {
    if (pattern.test(path)) console.log(`${(info.size / 1024).toFixed(0).padStart(8)} KB  ${path}`)
  }
}

closeSync(fd)
void createReadStream
void join
void existsSync
