/*
 * 会话事实（握手协商结果）的 Host 侧测试。
 *
 * 覆盖范围有意止于**初次握手**。强制第二次握手（rekey）在 loopback fixture 上
 * 不可达：ssh2 的 Client 只有在协议自己决定重协商时才会再发一次 handshake，
 * 而 fixture 没有触发它的手段。所以这个文件不编造一个不可能失败的 rekey 用例——
 * rekey 走的本来就是这里已经跑过的同一个监听器和同一个处理函数，差别只在
 * revision 递增，而客户端「取最新一组」的规则在 Task 5 用合成事件单独证明。
 *
 * 事实的来源必须是**真实握手**，不是桩：桩只能证明我们把自己的期望原样搬了一遍。
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { EVENTS, parseSessionFacts } from '@pureterm/protocol'
import { createHost } from '../dist/host.js'
import { startFakeSshServer } from '../../../apps/desktop/tests/fake-ssh-server.mjs'

/*
 * 算法名只断言「非空且是算法名会用的字符」，不写死具体字符串：fixture 有权重新
 * 协商，把 `aes128-gcm@openssh.com` 抄进断言就等于把一次库升级变成一次红灯。
 */
const ALGORITHM = /^[A-Za-z0-9@._+-]+$/

/**
 * 白盒读取会话记录上的 client。
 *
 * `sessions` 是 TS 的 `private`，运行时就是一个普通字段。监听器数量没有公开
 * 访问器，而「会话结束后必须摘掉 handshake 监听器」这条回归只能通过它证明：
 * 重连拿到的是**新的** client，所以只断言 `ssh.size` 归零根本抓不到这个漏。
 */
function clientOf(ssh, sessionId) {
  return ssh.sessions.get(sessionId).client
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-session-facts-'))
  const events = []
  const broadcast = []
  const host = await createHost({
    bridge: {
      getRenderer: id => ({
        id,
        isAlive: () => true,
        send: (name, ...params) => { events.push({ id, name, params }); return true },
      }),
    },
    hostStoreFile: join(directory, 'hosts.json'),
    secretsFile: join(directory, 'secrets.json'),
    knownHostsFile: join(directory, 'known_hosts.json'),
    ssh: { readyTimeout: 8000, keepaliveInterval: 0 },
    log: false,
  })
  // 直接订阅 Host 内部事件：用来证明「初次握手不该广播」这条规则本身。
  host.internals.ctx.on('ssh/session-facts', payload => broadcast.push(payload))
  t.after(async () => {
    try { await host.dispose() } finally { await rm(directory, { recursive: true, force: true }) }
  })
  return { host, events, broadcast, ssh: host.internals.ctx.ssh }
}

async function server(t) {
  const instance = await startFakeSshServer({ greeting: false })
  t.after(() => instance.close())
  return instance
}

/** 一个连上、开着终端、并且已经收到过握手事实的会话。 */
async function opened(t, clientId = 'first') {
  const host = await server(t)
  const f = await fixture(t)
  const session = await f.host.openTerminal({
    host: host.host, port: host.port, username: host.username, password: host.password, clientId,
  })
  return { server: host, ...f, sessionId: session.sessionId }
}

/** 送到渲染层的每一份事实，按发送顺序。 */
function delivered(events) {
  return events.filter(event => event.name === EVENTS.sessionFacts).map(event => event.params[0])
}

test('the negotiated algorithms reach the client right after terminal:opened', async t => {
  const { ssh, events, broadcast, sessionId } = await opened(t)

  const sent = delivered(events)
  assert.equal(sent.length, 1, '每个打开的终端恰好收到一份事实')
  const facts = sent[0]

  assert.equal(facts.sessionId, sessionId)
  assert.equal(facts.revision, 1)
  assert.match(facts.serverHostKey, ALGORITHM)
  assert.match(facts.cipher.clientToServer, ALGORITHM)
  assert.match(facts.cipher.serverToClient, ALGORITHM)

  // 用**线上契约自己的校验器**：Host 发出去的东西必须能过 UI 那一关。
  // 形状「差不多」不算数——一个多出来的字段会在协议层被整包丢掉。
  assert.deepEqual(parseSessionFacts(facts), facts)

  /*
   * 只带状态栏会渲染的三项。kex、mac、compression、lang 和远端软件版本都在同一份
   * 协商结果里，但没有任何界面会显示它们：多带一个就等于多一个没人读的契约。
   */
  assert.deepEqual(Object.keys(facts).sort(), ['cipher', 'revision', 'serverHostKey', 'sessionId'])
  assert.deepEqual(Object.keys(facts.cipher).sort(), ['clientToServer', 'serverToClient'])

  // 顺序是刻意的：先开终端，再给事实。客户端按「见过的会话」过滤事实，
  // 反过来的话它没有任何依据把这份事实归给谁。
  const names = events.map(event => event.name)
  assert.ok(names.indexOf(EVENTS.terminalOpened) < names.indexOf(EVENTS.sessionFacts))

  // 会话记录上存的那一份和发出去的必须是同一份，不能各说各话。
  assert.deepEqual(ssh.facts(sessionId), facts)

  // 初次握手发生在会话登记之前，此刻没有任何客户端拥有它，所以没有广播。
  assert.deepEqual(broadcast, [])
})

test('facts stay off the public session listing', async t => {
  const { ssh, sessionId } = await opened(t)

  const [listed] = ssh.list()
  assert.equal(listed.id, sessionId)
  // 事实挂在内部会话记录上，不跟着公开列表被抄来抄去。
  assert.equal('facts' in listed, false)
  assert.deepEqual(Object.keys(listed).sort(), ['host', 'id', 'port', 'username'])
})

test('a connection with no terminal still records its handshake facts', async t => {
  const host = await server(t)
  const { ssh, events } = await fixture(t)

  const session = await ssh.connect({
    host: host.host, port: host.port, username: host.username, password: host.password,
  })
  const facts = ssh.facts(session.id)
  assert.equal(facts.sessionId, session.id)
  assert.equal(facts.revision, 1)
  assert.match(facts.serverHostKey, ALGORITHM)
  assert.match(facts.cipher.serverToClient, ALGORITHM)
  // 事实属于会话记录，不属于终端桥：没有终端也有事实，也没有人需要被告知。
  assert.deepEqual(events, [])
})

test('facts() answers null for an unknown or already-closed session', async t => {
  const { host, ssh, sessionId } = await opened(t)

  assert.equal(ssh.facts('ssh-does-not-exist'), null)

  host.close(sessionId)
  assert.equal(ssh.has(sessionId), false)
  // 会话没了，它的事实也跟着走：否则重连后拿着旧 sessionId 还能读到上一轮的算法。
  assert.equal(ssh.facts(sessionId), null)
})

test('closing a session removes its one handshake listener', async t => {
  const { host, ssh, sessionId } = await opened(t)

  const client = clientOf(ssh, sessionId)
  // 恰好一个：每个连接只挂一个监听器，rekey 是让它再响一次，而不是再挂一个。
  assert.equal(client.listenerCount('handshake'), 1)

  host.close(sessionId)
  /*
   * 必须归零。留着的话，Host 已经丢弃的 client 上会继续攒监听器——每个监听器
   * 都闭包着一份 id 和一次 sessions.get，而那条会话永远不会再存在。
   */
  assert.equal(client.listenerCount('handshake'), 0)
})

test('a handshake that lands after the session closed is dropped, not buffered', async t => {
  const first = await opened(t)
  const { host, ssh, sessionId, events, broadcast } = first
  const initial = delivered(events)[0]
  const client = clientOf(ssh, sessionId)

  host.close(sessionId)
  const seen = events.length

  // 关掉之后再响一次握手，而且刻意换一组算法：如果哪里把事实缓存下来了，
  // 这份不一样的值就会露出来。
  client.emit('handshake', {
    kex: 'curve25519-sha256',
    serverHostKey: 'ssh-ed25519',
    cs: { cipher: 'aes256-ctr', mac: 'hmac-sha2-256', compress: 'none', lang: 'en-US' },
    sc: { cipher: 'aes256-ctr', mac: 'hmac-sha2-256', compress: 'none', lang: 'en-US' },
  })
  await delay(20)

  assert.equal(events.length, seen, '已关闭的会话不该再产生任何渲染层流量')
  assert.deepEqual(broadcast, [])
  assert.equal(ssh.facts(sessionId), null)

  // 重连：新的会话从 revision 1 重新开始，而不是接着上一轮的 2。
  const session = await host.openTerminal({
    host: first.server.host, port: first.server.port, username: first.server.username,
    password: first.server.password, clientId: 'second',
  })
  const again = delivered(events).at(-1)
  assert.notEqual(session.sessionId, sessionId)
  assert.equal(again.sessionId, session.sessionId)
  assert.equal(again.revision, 1)
  assert.match(again.serverHostKey, ALGORITHM)
  assert.notEqual(initial.sessionId, again.sessionId)
})
