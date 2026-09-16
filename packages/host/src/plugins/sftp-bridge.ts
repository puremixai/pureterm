import { Service, type Context } from 'cordis'
import type { FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2'
import {
  MAX_TRANSFER_BYTES,
  type SftpDir,
  type SftpEntry,
  type SftpReadResult,
  type SftpWriteResult,
} from '@pureterm/protocol'

declare module 'cordis' {
  interface Context {
    sftp: SftpBridge
  }
}

/**
 * 这几个形状定义在 `shared/protocol.ts`（渲染层也要用同一份），在这里再导出一次。
 * 目的和 `terminal-bridge` 的 `export type { TerminalOpenResult }` 一样：
 * 让 `src/host.ts` 只 import 插件一句就够，不必知道某个形状其实定义在 shared/ 里。
 */
export type { SftpDir, SftpEntry, SftpReadResult, SftpWriteResult } from '@pureterm/protocol'

/*
 * SftpBridge —— 远端文件系统。
 *
 * 为什么是**独立一个插件**而不是往 TerminalBridge 里塞几个方法：
 * SFTP 是另一个能力域（远端文件），不是「终端的一种用法」。终端和 SFTP 之间
 * 除了共用一条 SSH 连接之外没有任何关系——它们的生命周期、失败模式、并发模型都不同。
 * 合并的话，任何一次 SFTP 的改动都会落在终端那条链上，而终端是唯一保证可用的功能。
 *
 * 它 inject 的只有 `ssh`：文件操作的通道由连接引擎开（SshService.sftpSession），
 * 不通知渲染层（不需要事件——每个操作都是请求/响应，谁问谁等），
 * 也不碰 SessionStore（那是「连接目标」，跟远端文件无关）。
 */

/**
 * 远端路径**一律是 POSIX**，哪怕本机是 Windows。
 *
 * 所以这里不能用 `node:path`：在 Windows 上 `path.join('/home/a', 'b')` 会给出
 * `\home\a\b`，发给对端是一个不存在的路径，而报回来的错是「没有这个目录」——
 * 看起来像用户自己填错了，查半天查不出来。这一组是纯函数，可以在普通 Node 里直接测。
 *
 * 不把 `\` 当分隔符翻译成 `/`：在 POSIX 上反斜杠是**合法的文件名字符**，
 * 顺手翻译会静默改掉一个真实存在的文件名。宁可让用户看到「没有这个文件」。
 */
export function normalizeRemotePath(input: string): string {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return '.'
  const absolute = trimmed.startsWith('/')
  const segments: string[] = []
  for (const segment of trimmed.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      // 越过根就停在根：`/..` 仍然是 `/`。相对路径的 `..` 要留着——
      // 它表达的是「上一级」，我们没有起点，不该替用户编一个。
      if (segments.length && segments[segments.length - 1] !== '..') segments.pop()
      else if (!absolute) segments.push('..')
      continue
    }
    segments.push(segment)
  }
  const joined = segments.join('/')
  if (absolute) return `/${joined}`
  return joined || '.'
}

/** 把 `name` 接到 `dir` 后面。`name` 是绝对路径时它接管（和 POSIX 的语义一致）。 */
export function remoteJoin(dir: string, name: string): string {
  const leaf = (name ?? '').trim()
  if (!leaf) return normalizeRemotePath(dir)
  if (leaf.startsWith('/')) return normalizeRemotePath(leaf)
  const base = normalizeRemotePath(dir)
  return normalizeRemotePath(`${base === '/' ? '' : base}/${leaf}`)
}

/** 上一级。根和 `.` 的上一级是自己——面板上的「上级」按钮据此置灰 */
export function remoteParent(path: string): string {
  const absolute = normalizeRemotePath(path)
  if (absolute === '/' || absolute === '.') return absolute
  const index = absolute.lastIndexOf('/')
  if (index < 0) return '.'
  return index === 0 ? '/' : absolute.slice(0, index)
}

/** 末段。`/` 和 `.` 上没有末段，返回空串 */
export function remoteName(path: string): string {
  const absolute = normalizeRemotePath(path)
  if (absolute === '/' || absolute === '.') return ''
  const index = absolute.lastIndexOf('/')
  return index < 0 ? absolute : absolute.slice(index + 1)
}

/**
 * 新建/上传时的名字必须是**单独一段**。
 *
 * 这不只是输入校验，它是一条安全边界：名字直接来自界面，
 * 若允许它带 `/`，就等于允许界面把东西建到任意位置去（`../../etc/foo`），
 * 那一堆「先 realpath 目录再拼」的功夫全白做。反斜杠放行——
 * 在 POSIX 上它是合法的文件名字符。
 */
export function requireName(name: string): string {
  const leaf = (name ?? '').trim()
  if (!leaf || leaf === '.' || leaf === '..' || leaf.includes('/')) {
    throw new Error(`名字不对：「${leaf}」。请只填一个名字——不要带斜杠，也不要填 . 或 ..`)
  }
  return leaf
}

/**
 * 目录排序：目录在前，然后按名字。
 *
 * 放在这一层而不是界面里：**顺序是「这份数据长什么样」的一部分**，界面只负责照着画。
 * 换一个客户端、换一条载体不该得到另一个顺序，否则同一个目录在两处显示不同的排列，
 * 用户没法靠位置记住东西。
 *
 * 比较用码位（`<` / `>`）而不是 `localeCompare`：后者的结果依赖运行时带着哪份 ICU 数据，
 * 同一个目录在不同机器上可能排得不一样。「排序随环境变」这种事查起来极费劲，
 * 而这里并不需要语言敏感的排序。
 * 先比小写形式、再比原串，是为了让 `A` 和 `a` 挨着且顺序稳定。
 */
export function orderEntries(entries: SftpEntry[]): SftpEntry[] {
  return [...entries].sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1
    const a = left.name.toLowerCase()
    const b = right.name.toLowerCase()
    if (a !== b) return a < b ? -1 : 1
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  })
}

/** 操作类别。错误文案要按它分叉——同一个失败码在不同操作下是不同的事 */
export type SftpAction = 'list' | 'stat' | 'read' | 'write' | 'mkdir' | 'remove'

const DESCRIBE: Record<SftpAction, (path: string) => string> = {
  list: (path) => `读取目录 ${path}`,
  stat: (path) => `读取 ${path} 的属性`,
  read: (path) => `读取 ${path}`,
  write: (path) => `写入 ${path}`,
  mkdir: (path) => `新建目录 ${path}`,
  remove: (path) => `删除 ${path}`,
}

const ACTION_LABEL: Record<SftpAction, string> = {
  list: '读目录',
  stat: '读属性',
  read: '读文件',
  write: '写文件',
  mkdir: '建目录',
  remove: '删除',
}

/** SFTP 的状态码。ssh2 把它放在 error.code 上（数字） */
const SFTP_STATUS = {
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
  OP_UNSUPPORTED: 8,
} as const

/**
 * 把 ssh2 的 SFTP 错误翻译成「用户知道下一步该干什么」的中文。
 *
 * 和 `normalizeSshError` 一样导出：这些文案是对着真实性状表驱动测出来的，
 * 抄错一个词就会静默失效、把英文原文漏给用户，而那正是已经犯过的错。纯函数。
 *
 * 关键的一条：`FAILURE`(4) 是个**什么都可能是**的兜底码，OpenSSH 在
 * 「删非空目录」「目录已存在」「磁盘满」这几个场景上都回它。所以文案必须按
 * **操作**分叉，而不是按码——只按码只能写出一句「操作失败」，用户拿它做不了任何事。
 */
export function normalizeSftpError(error: unknown, action: SftpAction, path: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  const raw = (error as { code?: unknown } | null | undefined)?.code
  const status =
    typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : undefined

  if (status === SFTP_STATUS.NO_SUCH_FILE) {
    return new Error(
      action === 'write' || action === 'mkdir'
        ? `远端的目录不存在：${path} 不是一个能进去的目录。上传和新建都只能落在**已经存在**的目录里，` +
            `先在终端里把它建出来，或者换一个位置。`
        : `远端没有 ${path}——可能已经被移走或删掉了，点「刷新」再看一眼。`,
    )
  }
  if (status === SFTP_STATUS.PERMISSION_DENIED) {
    return new Error(`${DESCRIBE[action](path)} 失败：远端账号对这个位置没有权限（属主不对，或目录不可写）。`)
  }
  if (status === SFTP_STATUS.OP_UNSUPPORTED) {
    return new Error(`远端 SFTP 服务不支持「${ACTION_LABEL[action]}」这个操作。`)
  }
  if (status === SFTP_STATUS.FAILURE) {
    if (action === 'remove') {
      return new Error(`${DESCRIBE[action](path)} 失败：目录可能不是空的，或者它正被别的进程占用。空目录才能删。`)
    }
    if (action === 'mkdir') {
      return new Error(`${DESCRIBE[action](path)} 失败：这个名字可能已经存在了（同名文件或目录）。`)
    }
    if (action === 'write') {
      return new Error(`${DESCRIBE[action](path)} 失败：远端可能没有空间了，或者这个目录不可写。`)
    }
    return new Error(`${DESCRIBE[action](path)} 失败：远端拒绝了这次操作（${message}）。`)
  }
  // 码拿不到时兜一层文案匹配。顺序不能反：有些实现只给文案不给码。
  if (/no such file|not exist/i.test(message)) {
    return new Error(`远端没有 ${path}——可能已经被移走或删掉了，点「刷新」再看一眼。`)
  }
  if (/permission denied/i.test(message)) {
    return new Error(`${DESCRIBE[action](path)} 失败：远端账号对这个位置没有权限。`)
  }
  return new Error(`${DESCRIBE[action](path)} 失败：${message}`)
}

export class SftpBridge extends Service {
  static inject = ['ssh']

  constructor(ctx: Context) {
    super(ctx, 'sftp')
  }

  /**
   * 列一个目录。
   *
   * 返回的 `path` 是**对端 realpath 之后**的绝对路径，不是请求里那一个：
   * 请求传 `.` 时它会被解成 home 的绝对路径，面板据此才知道自己现在在哪。
   * 界面必须用返回的这个值当状态，不能用自己请求的那个。
   */
  async list(sessionId: string, path: string): Promise<SftpDir> {
    const sftp = await this.ctx.ssh.sftpSession(sessionId)
    const absolute = await this.realpath(sftp, await this.expand(sftp, path, 'list'), 'list')
    const found = await new Promise<FileEntryWithStats[]>((resolve, reject) => {
      sftp.readdir(absolute, (error, list) => {
        if (error) reject(normalizeSftpError(error, 'list', absolute))
        else resolve(list ?? [])
      })
    })

    // ssh2 的 readdir 默认已经把 `.` / `..` 滤掉了，这里再滤一次是有意的：
    // 「面板上不出现 . 和 ..」是**我们自己的契约**（上级靠按钮走），
    // 不该依赖某个库内部的默认行为——换个 SFTP 实现这里就得跟着改，而那时
    // 症状是列表里冒出两行奇怪的东西，没人会想到是库的默认值变了。
    const kept = found.filter((entry) => entry.filename !== '.' && entry.filename !== '..')
    const parent = remoteParent(absolute)
    return {
      path: absolute,
      // 「已经在根上」的判据是**上一级等于自己**，不是「等于 '/'」：
      // 被 chroot 的账号根就是它自己的 home，拿 '/' 去比会永远给一个点了没用的上级按钮。
      parent: parent === absolute ? null : parent,
      entries: await this.mapEntries(sftp, absolute, kept),
    }
  }

  /**
   * 读一个文件，内容整份带回渲染层。
   *
   * 超过上限**直接拒绝**，不截断：截断的下载看起来是成功的——
   * 用户拿到一个能打开、能保存、内容少了一半的文件，这比报错坏得多。
   */
  async read(sessionId: string, path: string): Promise<SftpReadResult> {
    const sftp = await this.ctx.ssh.sftpSession(sessionId)
    const absolute = await this.realpath(sftp, await this.expand(sftp, path, 'read'), 'read')
    const stats = await this.stat(sftp, absolute, 'read')

    if (stats.isDirectory()) throw new Error(`${absolute} 是一个目录，不能当文件下载。`)
    if (stats.size > MAX_TRANSFER_BYTES) {
      throw new Error(
        `${absolute} 有 ${stats.size} 字节，超过单次传输上限 ${MAX_TRANSFER_BYTES} 字节。` +
          `文件内容要整份走 base64 + JSON 过线（Web 载体的单条报文上限是 8 MiB），` +
          `分块流式传输还没做。先用终端里的 scp / rsync 拿这个文件。`,
      )
    }

    const bytes = await new Promise<Buffer>((resolve, reject) => {
      sftp.readFile(absolute, (error, data) => {
        if (error) reject(normalizeSftpError(error, 'read', absolute))
        else resolve(data)
      })
    })

    // 报实际送出去的字节数，而不是 stat 里的 size：文件在两次调用之间变大变小时，
    // 用户该看到的是真实发生的事，不是我们刚才量到的那个数。
    return { path: absolute, size: bytes.length, bytes }
  }

/** 写一个文件（已存在就覆盖）。内容整份来自渲染层。 */
  async write(sessionId: string, dir: string, name: string, bytes: Uint8Array): Promise<SftpWriteResult> {
    const sftp = await this.ctx.ssh.sftpSession(sessionId)
    // 不复制：只在这段内存上开一个视图，大文件下省一次整份拷贝
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (data.length > MAX_TRANSFER_BYTES) {
      throw new Error(
        `要上传的内容有 ${data.length} 字节，超过单次传输上限 ${MAX_TRANSFER_BYTES} 字节。` +
          `分块流式上传还没做，先换个小一点的文件。`,
      )
    }

    const target = await this.resolveTarget(sftp, dir, name, 'write')
    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(target.full, data, (error) => {
        if (error) reject(normalizeSftpError(error, 'write', target.full))
        else resolve()
      })
    })
    return { path: target.full, size: data.length }
  }

  /** 新建一个目录。父目录必须已存在——不递归建，递归建的话失败在哪一层说不清。 */
  async mkdir(sessionId: string, dir: string, name: string): Promise<void> {
    const sftp = await this.ctx.ssh.sftpSession(sessionId)
    const target = await this.resolveTarget(sftp, dir, name, 'mkdir')
    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(target.full, (error) => {
        if (error) reject(normalizeSftpError(error, 'mkdir', target.full))
        else resolve()
      })
    })
  }

  /** 删除一个文件或空目录。 */
  async remove(sessionId: string, path: string): Promise<void> {
    const sftp = await this.ctx.ssh.sftpSession(sessionId)
    const expanded = await this.expand(sftp, path, 'remove')
    const name = remoteName(expanded)
    if (!name) throw new Error(`路径不对：${path} 指的是一个目录本身，没有东西可以删。`)

    /*
     * 这里**绝不能** realpath 整个路径：realpath 会跟随软链，于是
     * 「删掉这个链接」会悄悄变成「删掉链接指向的那个文件」——一个后果很严重的静默错误。
     * 只 realpath 父目录、末段原样保留，删的就是用户点的那一项。
     */
    const target = await this.resolveTarget(sftp, remoteParent(expanded), name, 'remove')

    /*
     * 用 lstat 而不是 stat：要判断的是「用户点的那一项本身是不是目录」，不是它指向什么。
     * 一个指向目录的软链，用 stat 看是目录 → 会去 rmdir 它 → 对端报 FAILURE
     * （rmdir 不接受软链），而用 lstat 看不是目录 → unlink 掉链接本身，正是用户想要的。
     */
    const stats = await this.lstat(sftp, target.full, 'remove')
    const drop: 'rmdir' | 'unlink' = stats.isDirectory() ? 'rmdir' : 'unlink'
    await new Promise<void>((resolve, reject) => {
      sftp[drop](target.full, (error) => {
        if (error) reject(normalizeSftpError(error, 'remove', target.full))
        else resolve()
      })
    })
  }

  // ── 路径与通道的私有实现 ──────────────────────────────────────

  /**
   * 支持开头的 `~`。
   *
   * 按「SFTP 子系统的工作目录」解，而不是去查 passwd：子系统的初始目录**就是**用户的
   * home（OpenSSH 的 sftp-server 起来会先 chdir 过去），所以 `realpath('.')` 拿到的
   * 正是 home 的绝对路径。这样不需要 expand-path@openssh.com 扩展（老服务器不一定有），
   * 而且 chroot 环境里给出的刚好是用户看得见的那个根——比查 passwd 更对。
   */
  private async expand(sftp: SFTPWrapper, path: string, action: SftpAction): Promise<string> {
    const normalized = normalizeRemotePath(path)
    if (normalized !== '~' && !normalized.startsWith('~/')) return normalized
    const home = await this.realpath(sftp, '.', action)
    return normalized === '~' ? home : remoteJoin(home, normalized.slice(2))
  }

  /**
   * 定位「某个目录里的某个名字」（上传 / 新建目录）。
   *
   * 只 realpath **目录**再拼回名字，不直接 realpath 整个路径：
   * OpenSSH 的 sftp-server 处理 REALPATH 走的是 realpath(3)，对**不存在的叶子路径**
   * 会回 NO_SUCH_FILE——而这两件事的目标恰好经常还不存在（新文件、新目录）。
   * 目录一定是存在的，拿它的规范形式（解掉软链、`~`、相对段）再拼回名字，
   * 结果一样准，还不会因为「目标不存在」而失败。
   */
  private async resolveTarget(
    sftp: SFTPWrapper,
    dir: string,
    name: string,
    action: SftpAction,
  ): Promise<{ name: string; full: string }> {
    const leaf = requireName(name)
    // action 一路带下去：目录不存在时要说「上传/新建只能落在已存在的目录里」，
    // 而笼统的「读属性失败」会让用户去别处找原因
    const directory = await this.realpath(sftp, await this.expand(sftp, dir, action), action)
    return { name: leaf, full: remoteJoin(directory, leaf) }
  }

  private realpath(sftp: SFTPWrapper, path: string, action: SftpAction): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      sftp.realpath(path, (error, absolute) => {
        if (error) reject(normalizeSftpError(error, action, path))
        else resolve(absolute)
      })
    })
  }

  private stat(sftp: SFTPWrapper, path: string, action: SftpAction): Promise<Stats> {
    return new Promise<Stats>((resolve, reject) => {
      sftp.stat(path, (error, stats) => {
        if (error) reject(normalizeSftpError(error, action, path))
        else resolve(stats)
      })
    })
  }

  /** 与 stat 的区别只在「跟不跟软链」：要判断某一项**本身**是什么的时候用这个 */
  private lstat(sftp: SFTPWrapper, path: string, action: SftpAction): Promise<Stats> {
    return new Promise<Stats>((resolve, reject) => {
      sftp.lstat(path, (error, stats) => {
        if (error) reject(normalizeSftpError(error, action, path))
        else resolve(stats)
      })
    })
  }

  /**
   * 把 readdir 的原始项翻成我们要的形状，并排好序。
   *
   * 对**软链项**额外补一次 stat（跟随链接）：readdir 给的属性是 lstat 的结果，
   * 一个「指向目录的软链」和「普通文件」在属性上长得一模一样，界面于是只能猜
   * 那一行该是「打开」还是「下载」。补这一次之后，isDirectory 说的是
   * 「点下去会发生什么」，界面不必猜。只有软链会多这一趟，普通目录一份也不多花。
   *
   * 补 stat 失败（断链、目标没有权限）时**退回 lstat 的判断**、当文件看：
   * 链接本身确实存在，列表里不该凭空少一行；点下去会得到一句明确的报错，
   * 而不是一个假装成功的结果。这个吞掉异常是**显示层**的降级，不是把错误藏起来。
   */
  private async mapEntries(
    sftp: SFTPWrapper,
    directory: string,
    found: readonly FileEntryWithStats[],
  ): Promise<SftpEntry[]> {
    const mapped = await Promise.all(
      found.map(async (entry) => {
        const item = this.toEntry(directory, entry)
        if (!item.isSymlink) return item
        try {
          const stats = await this.stat(sftp, item.path, 'stat')
          return { ...item, isDirectory: stats.isDirectory(), size: stats.size }
        } catch {
          return item
        }
      }),
    )
    return orderEntries(mapped)
  }

  private toEntry(directory: string, entry: FileEntryWithStats): SftpEntry {
    const attrs = entry.attrs
    return {
      name: entry.filename,
      path: remoteJoin(directory, entry.filename),
      isDirectory: typeof attrs.isDirectory === 'function' ? attrs.isDirectory() : false,
      isSymlink: typeof attrs.isSymbolicLink === 'function' ? attrs.isSymbolicLink() : false,
      size: typeof attrs.size === 'number' ? attrs.size : 0,
      mtime: typeof attrs.mtime === 'number' ? attrs.mtime : 0,
      mode: typeof attrs.mode === 'number' ? attrs.mode : 0,
    }
  }
}
