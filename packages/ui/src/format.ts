/*
 * 展示用的格式化。**只做显示**，不参与任何判断。
 *
 * 单独一个模块的理由很小但很实在：远端文件相关的两处都要用（面板画每一行、
 * app.ts 在下载前后说大小），而格式化规则出现两份，就会出现「同一个文件在列表里
 * 是 12.3 KB、在提示里是 12 KB」这种没人能解释的不一致。
 */

/** 字节数。1024 进制，标 KB/MB——用户要对照的是文件大小，不是磁盘容量 */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '—'
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[index]}`
}

/**
 * 网络速率。**从 kB 起读**，不是从字节起读：一块网卡的读数几乎不会停在 1 kB/s 以下，
 * 把 409 B/s 写成字节只是在数零，而参考形态要的正是 kB/s 这一档。超过 1024 kB/s 才
 * 进位到 MB/s，之后照旧 —— 只有起始单位和 formatBytes 不同，标 KB 的那个仍然管文件。
 */
export function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return '—'
  if (bytesPerSecond === 0) return '0 kB/s'
  const units = ['kB/s', 'MB/s', 'GB/s', 'TB/s']
  let value = bytesPerSecond / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[index]}`
}

/**
 * 秒级 Unix 时间戳 → 本地时区的「YYYY-MM-DD HH:mm」。
 *
 * 对端给的是**秒**（SFTP 的 attrs.mtime 就是秒），不是毫秒：直接塞给 Date 会得到
 * 1970 年，而且列表照样画得出来，所以这个错会一直藏着——这就是要在这里写清楚的原因。
 * 用本地时区：用户想知道「这是什么时候改的」，参照系是他自己那块表。
 */
export function formatTime(seconds: number): string {
  if (!seconds) return '—'
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
