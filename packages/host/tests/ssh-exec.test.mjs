import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createHost } from '../dist/host.js'
import { startFakeSshServer } from '../../../apps/desktop/tests/fake-ssh-server.mjs'

async function until(predicate, description, timeout = 3000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(5)
  }
  assert.fail(`Timed out waiting for ${description}`)
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-ssh-exec-'))
  const events = []
  const host = await createHost({
    bridge: {
      getRenderer: id => ({
        id,
        isAlive: () => true,
        send: (name, ...params) => { events.push({ name, params }); return true },
      }),
    },
    hostStoreFile: join(directory, 'hosts.json'),
    secretsFile: join(directory, 'secrets.json'),
    knownHostsFile: join(directory, 'known_hosts.json'),
    ssh: { readyTimeout: 8000, keepaliveInterval: 0 },
    log: false,
  })
  t.after(async () => {
    try { await host.dispose() } finally { await rm(directory, { recursive: true, force: true }) }
  })
  return { host, events, ssh: host.internals.ctx.ssh }
}

/** A connected session with a shell, so exec can be exercised beside a live terminal. */
async function connected(t, serverOptions = {}) {
  const server = await startFakeSshServer({ greeting: false, ...serverOptions })
  t.after(() => server.close())
  const f = await fixture(t)
  const session = await f.host.openTerminal({
    host: server.host, port: server.port, username: server.username, password: server.password, clientId: 'first',
  })
  return { server, ...f, sessionId: session.sessionId }
}

test('a normal command resolves with its stdout, exit code and no truncation flag', async t => {
  const { ssh, sessionId } = await connected(t, { execOutput: 'cpu 1 2 3\n' })
  const result = await ssh.exec(sessionId, 'cat /proc/stat')
  assert.equal(result.stdout, 'cpu 1 2 3\n')
  assert.equal(result.stderr, '')
  assert.equal(result.code, 0)
  // The flag is gone rather than preserved: an overflow is now a rejection, and a
  // silently shortened frame would be blamed on the remote data instead of on us.
  assert.equal('truncated' in result, false)
  assert.equal(ssh.pendingExecs(sessionId), 0)
})

test('an abort before the request is sent never reaches the remote at all', async t => {
  const { server, ssh, sessionId } = await connected(t)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(ssh.exec(sessionId, 'never-runs', { signal: controller.signal }), /取消/)
  assert.deepEqual(server.exec.commands, [])
  assert.equal(ssh.pendingExecs(sessionId), 0)
})

test('an abort while the channel is opening rejects at once and closes the channel that arrives later', async t => {
  let accepted
  const { server, ssh, sessionId } = await connected(t, {
    onExec: ({ accept }) => { accepted = setTimeout(() => { const stream = accept(); stream.write('late\n'); stream.exit(0); stream.end() }, 400) },
  })
  t.after(() => clearTimeout(accepted))
  const controller = new AbortController()
  const started = Date.now()
  const running = ssh.exec(sessionId, 'slow-open', { signal: controller.signal })
  await until(() => server.exec.commands.length === 1, 'the exec request reaching the server')
  controller.abort()
  await assert.rejects(running, /取消/)
  // The point of moving the timer outside the ssh2 callback: the caller learns
  // immediately, instead of after however long the server takes to open a channel.
  assert.ok(Date.now() - started < 350, `the abort waited for the channel (${Date.now() - started}ms)`)
  assert.equal(ssh.pendingExecs(sessionId), 0)
  // The channel that opened after the cancellation has no owner, so it must be closed
  // rather than left for the remote to keep counting against MaxSessions.
  await until(() => server.exec.closed === 1, 'the late channel being closed')
  assert.equal(server.exec.active, 0)
})

test('the timeout covers channel acquisition, and a channel that opens after it is closed', async t => {
  let accepted
  const { server, ssh, sessionId } = await connected(t, {
    onExec: ({ accept }) => { accepted = setTimeout(() => { const stream = accept(); stream.write('too late\n'); stream.exit(0); stream.end() }, 400) },
  })
  t.after(() => clearTimeout(accepted))
  const started = Date.now()
  await assert.rejects(ssh.exec(sessionId, 'never-opens', { timeout: 120 }), /超时/)
  assert.ok(Date.now() - started < 350, `the timeout did not include acquisition (${Date.now() - started}ms)`)
  assert.equal(ssh.pendingExecs(sessionId), 0)
  await until(() => server.exec.closed === 1, 'the channel that opened after the timeout being closed')
  assert.equal(server.exec.active, 0)
})

test('a hung command is rejected by its deadline rather than held open', async t => {
  const { ssh, sessionId } = await connected(t, {
    // Accepted, but it never writes and never exits: the case a monitoring probe hits
    // when a remote command blocks on something.
    onExec: ({ accept }) => { accept() },
  })
  await assert.rejects(ssh.exec(sessionId, 'sleep 1000', { timeout: 150 }), /超时/)
  assert.equal(ssh.pendingExecs(sessionId), 0)
})

test('stdout and stderr are counted against one bound, and overflow rejects instead of truncating', async t => {
  const { ssh, sessionId } = await connected(t, {
    onExec: ({ accept }) => {
      const stream = accept()
      stream.write(Buffer.alloc(40_000, 0x61))
      stream.write(Buffer.alloc(25_537, 0x62)) // 65,537 together
      stream.exit(0)
      stream.end()
    },
  })
  await assert.rejects(ssh.exec(sessionId, 'huge', { maxBytes: 65_536 }), /65536/)
  assert.equal(ssh.pendingExecs(sessionId), 0)
})

test('stderr alone is bounded too, so a failing command cannot grow memory without limit', async t => {
  const { ssh, sessionId } = await connected(t, {
    onExec: ({ accept }) => {
      const stream = accept()
      // Counting only stdout would let this run forever; the monitoring command writes
      // its errors here, which is exactly when a probe goes wrong.
      stream.stderr.write(Buffer.alloc(65_537, 0x65))
      stream.exit(1)
      stream.end()
    },
  })
  await assert.rejects(ssh.exec(sessionId, 'noisy', { maxBytes: 65_536 }), /65536/)
  assert.equal(ssh.pendingExecs(sessionId), 0)
})

test('a command exactly at the bound still succeeds, and stderr is reported separately', async t => {
  const { ssh, sessionId } = await connected(t, {
    onExec: ({ accept }) => {
      const stream = accept()
      stream.write(Buffer.alloc(40_000, 0x61))
      stream.stderr.write(Buffer.alloc(25_536, 0x62)) // exactly 65,536
      stream.exit(3)
      stream.end()
    },
  })
  const result = await ssh.exec(sessionId, 'exact', { maxBytes: 65_536 })
  assert.equal(result.stdout.length, 40_000)
  assert.equal(result.stderr.length, 25_536)
  assert.equal(result.code, 3)
})

test('multibyte output split across chunks decodes as characters, not as replacement bytes', async t => {
  const { ssh, sessionId } = await connected(t, {
    onExec: ({ accept }) => {
      const stream = accept()
      const text = Buffer.from('你好，世界')
      // Deliberately cut inside the first code point, the way SSH splits packets.
      stream.write(text.subarray(0, 1))
      setTimeout(() => { stream.write(text.subarray(1)); stream.exit(0); stream.end() }, 20)
    },
  })
  const result = await ssh.exec(sessionId, 'echo 你好')
  assert.equal(result.stdout, '你好，世界')
  assert.equal(result.stdout.includes('\uFFFD'), false)
})

test('a command with no exit status still resolves with a null code', async t => {
  const { ssh, sessionId } = await connected(t, {
    // No stream.exit(): some servers close the channel without an exit-status message.
    onExec: ({ accept }) => { const stream = accept(); stream.write('no-status\n'); stream.end() },
  })
  const result = await ssh.exec(sessionId, 'no-status')
  assert.equal(result.stdout, 'no-status\n')
  assert.equal(result.code, null)
})

test('a rejected command channel is reported as a command problem, not as a missing SFTP subsystem', async t => {
  const { ssh, sessionId } = await connected(t, {
    onExec: ({ reject }) => reject(),
  })
  await assert.rejects(ssh.exec(sessionId, 'forbidden'), error => {
    // ssh2 uses `Channel open failure` for both, so the message has to follow the
    // channel the caller asked for: telling a probe to check `Subsystem sftp` would
    // point the user at a setting that has nothing to do with the failure.
    assert.doesNotMatch(error.message, /SFTP/)
    assert.match(error.message, /命令通道|通道/)
    return true
  })
  assert.equal(ssh.pendingExecs(sessionId), 0)
})

test('disposing the session rejects a pending command promptly instead of waiting for its deadline', async t => {
  const { host, ssh, sessionId } = await connected(t, {
    onExec: ({ accept }) => { accept() },
  })
  const running = ssh.exec(sessionId, 'sleep 1000', { timeout: 30_000 })
  const started = Date.now()
  host.close(sessionId)
  await assert.rejects(running, /会话已关闭/)
  // 30s of deadline left, so a prompt rejection is the whole point: a dropped connection
  // must not be reported as a slow command.
  assert.ok(Date.now() - started < 2000, `disposal waited for the deadline (${Date.now() - started}ms)`)
  assert.equal(ssh.has(sessionId), false)
})

test('a command that fails leaves the terminal on the same connection usable', async t => {
  const { host, ssh, server, events, sessionId } = await connected(t, {
    onExec: ({ reject }) => reject(),
  })
  await assert.rejects(ssh.exec(sessionId, 'forbidden'), /通道/)
  // Cancelling or failing an exec closes only its own channel. The shell opened by
  // openTerminal shares the same SSH connection, and it has to keep working.
  assert.equal(server.connections, 1)
  host.input(sessionId, 'hello\n')
  await until(
    () => events.some(event => event.name === 'terminal:data' && Buffer.from(event.params[1]).toString().includes('echo:hello')),
    'the shell echoing input after a failed command channel',
  )
  assert.equal(server.terminal.inputs.length > 0, true)
})
