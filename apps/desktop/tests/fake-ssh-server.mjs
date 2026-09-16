// Newly written local protocol fixture; this is not a recovered historical test.
// Files stay in memory and the TCP listener always binds to IPv4 loopback.
import { createHash, generateKeyPairSync } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { posix } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

const require = createRequire(import.meta.url)
const { Server, utils } = require('ssh2')
const STATUS = utils.sftp.STATUS_CODE

function createFiles(initial, symlinks, home) {
  const nodes = new Map()
  const absolute = (path) => posix.resolve(home, path)
  const directory = (path) => {
    if (nodes.has(path)) return
    if (path !== '/') directory(posix.dirname(path))
    nodes.set(path, { kind: 'dir' })
  }
  directory(home)
  for (const [path, data] of Object.entries(initial)) {
    const full = absolute(path)
    directory(posix.dirname(full))
    nodes.set(full, data === null ? { kind: 'dir' } : { kind: 'file', data: Buffer.from(data) })
  }
  for (const [path, target] of Object.entries(symlinks)) {
    const full = absolute(path)
    directory(posix.dirname(full))
    nodes.set(full, { kind: 'link', target })
  }
  const fail = (code = STATUS.NO_SUCH_FILE) => { throw Object.assign(new Error('Fixture filesystem error'), { code }) }
  const resolve = (path, follow = true, depth = 0) => {
    if (depth > 20) fail(STATUS.FAILURE)
    const full = absolute(path)
    const parts = full.split('/').filter(Boolean)
    let current = '/'
    for (let index = 0; index < parts.length; index++) {
      current = posix.join(current, parts[index])
      const node = nodes.get(current)
      if (!node) fail()
      if (node.kind === 'link' && (follow || index < parts.length - 1)) {
        const target = posix.resolve(posix.dirname(current), node.target, ...parts.slice(index + 1))
        return resolve(target, follow, depth + 1)
      }
      if (index < parts.length - 1 && node.kind !== 'dir') fail()
    }
    if (!nodes.has(current)) fail()
    return current
  }
  const entry = (path, follow = true) => nodes.get(resolve(path, follow))
  const attrs = (node) => ({
    mode: (node.kind === 'dir' ? 0o040755 : node.kind === 'link' ? 0o120777 : 0o100644),
    uid: 1000, gid: 1000, size: node.data?.length ?? 0, atime: 1700000000, mtime: 1700000000,
  })
  const target = (path) => posix.join(resolve(posix.dirname(absolute(path))), posix.basename(path))
  const children = (path) => [...nodes.keys()].filter((name) => name !== path && posix.dirname(name) === path)
  return {
    nodes, absolute, resolve, entry, attrs, target, children, fail,
    dataOf: (path) => Buffer.from(entry(path).data),
    exists: (path) => { try { resolve(path, false); return true } catch { return false } },
    isDir: (path) => { try { return entry(path).kind === 'dir' } catch { return false } },
  }
}

function attachSftp(stream, files, stats) {
  stats.channels++
  let counter = 0
  const handles = new Map()
  const get = (handle) => handles.get(handle.toString('hex')) ?? files.fail(STATUS.FAILURE)
  const makeHandle = (record) => {
    const handle = Buffer.alloc(4)
    handle.writeUInt32BE(++counter)
    handles.set(handle.toString('hex'), record)
    return handle
  }
  const on = (name, handler) => stream.on(name, (id, ...args) => {
    stats.requests.push(name)
    try { handler(id, ...args) } catch (error) { stream.status(id, error.code ?? STATUS.FAILURE) }
  })
  on('REALPATH', (id, path) => {
    const full = files.resolve(path)
    stream.name(id, [{ filename: full, longname: full, attrs: files.attrs(files.entry(full)) }])
  })
  for (const name of ['STAT', 'LSTAT']) {
    on(name, (id, path) => stream.attrs(id, files.attrs(files.entry(path, name === 'STAT'))))
  }
  on('FSTAT', (id, handle) => stream.attrs(id, files.attrs(files.entry(get(handle).path))))
  on('OPENDIR', (id, path) => {
    const full = files.resolve(path)
    if (!files.isDir(full)) files.fail(STATUS.FAILURE)
    stream.handle(id, makeHandle({ path: full, directory: true, read: false }))
  })
  on('READDIR', (id, handle) => {
    const record = get(handle)
    if (!record.directory) files.fail(STATUS.FAILURE)
    if (record.read) return stream.status(id, STATUS.EOF)
    record.read = true
    const entries = ['.', '..', ...files.children(record.path).map((path) => posix.basename(path))].map((filename) => ({
      filename, longname: filename,
      attrs: files.attrs(files.entry(posix.join(record.path, filename), false)),
    }))
    stream.name(id, entries)
  })
  on('OPEN', (id, path, flags) => {
    const full = files.target(path)
    const mode = utils.sftp.flagsToString(flags)
    const writable = mode?.includes('w') || mode?.includes('a') || mode?.includes('+')
    if (!files.nodes.has(full)) {
      if (!mode?.includes('w') && !mode?.includes('a')) files.fail()
      files.nodes.set(full, { kind: 'file', data: Buffer.alloc(0) })
    }
    const node = files.entry(full)
    if (node.kind !== 'file') files.fail(STATUS.FAILURE)
    if (mode?.startsWith('w')) node.data = Buffer.alloc(0)
    stream.handle(id, makeHandle({ path: files.resolve(full), writable }))
  })
  on('READ', (id, handle, offset, length) => {
    const data = files.entry(get(handle).path).data
    if (offset >= data.length) return stream.status(id, STATUS.EOF)
    stream.data(id, data.subarray(offset, offset + length))
  })
  on('WRITE', (id, handle, offset, data) => {
    const record = get(handle)
    if (!record.writable) files.fail(STATUS.PERMISSION_DENIED)
    const node = files.entry(record.path)
    const next = Buffer.alloc(Math.max(node.data.length, offset + data.length))
    node.data.copy(next)
    data.copy(next, offset)
    node.data = next
    stats.writes.push({ path: record.path, offset, length: data.length })
    stream.status(id, STATUS.OK)
  })
  on('CLOSE', (id, handle) => {
    if (!handles.delete(handle.toString('hex'))) files.fail(STATUS.FAILURE)
    stream.status(id, STATUS.OK)
  })
  on('MKDIR', (id, path) => {
    const full = files.target(path)
    if (files.nodes.has(full)) files.fail(STATUS.FAILURE)
    if (!files.isDir(posix.dirname(full))) files.fail()
    files.nodes.set(full, { kind: 'dir' })
    stats.mkdirs.push(full)
    stream.status(id, STATUS.OK)
  })
  for (const name of ['REMOVE', 'RMDIR']) {
    on(name, (id, path) => {
      const full = files.resolve(path, false)
      const node = files.entry(full, false)
      if (name === 'RMDIR' ? node.kind !== 'dir' || files.children(full).length : node.kind === 'dir') files.fail(STATUS.FAILURE)
      files.nodes.delete(full)
      stats.removals.push(full)
      stream.status(id, STATUS.OK)
    })
  }
  stream.on('error', () => {}) // Closing a client may abort an in-flight fixture channel.
}

export async function startFakeSshServer(options = {}) {
  const username = options.username ?? 'demo'
  const password = options.password ?? 'test-password'
  const hostKey = options.hostKey ?? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' })
  const parsedKey = utils.parseKey(hostKey)
  const publicKey = parsedKey.getPublicSSH()
  // Optional test-only authorized key. Reusing this fixture's ephemeral key keeps
  // public-key tests self-contained and never touches the user's SSH files.
  const authentications = []
  const files = createFiles(options.files ?? {}, options.symlinks ?? {}, options.home ?? '/home/demo')
  const sftp = { channels: 0, requests: [], writes: [], mkdirs: [], removals: [] }
  const terminal = { ptys: [], windows: [], inputs: [] }
  const sockets = new Set()
  const ssh = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('error', () => {}) // Rejected authentication/TOFU intentionally aborts the connection.
    client.on('authentication', (ctx) => {
      if (ctx.username === username && ctx.method === 'password' && ctx.password === password) {
        authentications.push('password')
        ctx.accept()
      } else if (options.keyAuthentication && ctx.username === username && ctx.method === 'publickey'
        && ctx.key.algo === parsedKey.type && ctx.key.data.equals(publicKey)
        && (!ctx.signature || parsedKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true)) {
        // SSH may probe a key before sending a signature. Only count an actual
        // signed authentication, so the browser test cannot pass on a probe.
        if (ctx.signature) authentications.push('publickey')
        ctx.accept()
      } else ctx.reject(options.keyAuthentication ? ['password', 'publickey'] : ['password'])
    })
    client.on('ready', () => client.on('session', (accept) => {
      const session = accept()
      session.on('pty', (acceptPty, _reject, info) => { terminal.ptys.push(info); acceptPty?.() })
      session.on('window-change', (acceptWindow, _reject, info) => { terminal.windows.push(info); acceptWindow?.() })
      session.on('sftp', (acceptSftp) => attachSftp(acceptSftp(), files, sftp))
      session.on('shell', (acceptShell) => {
        const stream = acceptShell()
        stream.on('error', () => {})
        const decoder = new StringDecoder('utf8')
        let input = ''
        let previousCR = false
        stream.on('data', (chunk) => {
          terminal.inputs.push(Buffer.from(chunk))
          for (const character of decoder.write(chunk)) {
            if (character !== '\n' || !previousCR) input += character === '\r' ? '\n' : character
            previousCR = character === '\r'
          }
          for (;;) {
            const index = input.indexOf('\n')
            if (index < 0) break
            const line = input.slice(0, index).replace(/\r$/, '')
            input = input.slice(index + 1)
            if (line === 'exit') { stream.exit(0); stream.end(); break }
            stream.write(`echo:${line}\r\n`)
          }
        })
        if (options.greeting !== false) {
          const welcome = Buffer.from(options.greeting ?? '你好，世界\r\n')
          // Deliberately cut inside the first UTF-8 code point.
          stream.write(welcome.subarray(0, 1))
          const timer = setTimeout(() => { if (!stream.destroyed) stream.write(welcome.subarray(1)) }, 25)
          stream.once('close', () => clearTimeout(timer))
        }
      })
    }))
  })
  const listener = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    ssh.injectSocket(socket)
  })
  await new Promise((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(options.port ?? 0, '127.0.0.1', resolve)
  })
  let closed = false
  return {
    host: '127.0.0.1', port: listener.address().port, username, password, hostKey,
    fingerprint: `SHA256:${createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`,
    files, sftp, terminal, authentications,
    get connections() { return sockets.size },
    async close() {
      if (closed) return
      closed = true
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
    },
  }
}

export const createFakeSshServer = startFakeSshServer
