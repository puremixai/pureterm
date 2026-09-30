import assert from 'node:assert/strict'
import test from 'node:test'
import { t } from '@pureterm/i18n'
import { NODE_COUNT, STAGES, diagnose, errorText, stageKey } from '../src/failure-diagnostics.ts'
import { resolveMessage } from '../src/message-text.ts'

/*
 * 每个码死在哪一步。
 *
 * 这张表从前照抄的是宿主的中文句子，于是它成了「契约的第二次表述」：宿主改一个
 * 措辞，这里就静默失配，页面把一个已经说清楚的失败塌成一个点。现在断言的是**码**
 * —— 跨线的那一半 —— 而不是它此刻被译成哪句话。
 */
const CASES = [
  ['ssh.dns-failed', 'address'],
  ['ssh.connection-refused', 'tcp'],
  ['ssh.timeout', 'tcp'],
  ['ssh.connection-reset', 'tcp'],
  ['ssh.handshake-closed', 'handshake'],
  ['ssh.banner-before-handshake', 'handshake'],
  ['ssh.host-key-changed', 'keyexchange'],
  ['ssh.host-key-verification-failed', 'keyexchange'],
  ['ssh.first-connection', 'keyexchange'],
  ['ssh.auth-failed', 'auth'],
  ['ssh.key-passphrase-needed', 'auth'],
  ['ssh.key-unrecognized', 'auth'],
  ['ssh.key-unparseable', 'auth'],
  ['ssh.sftp-subsystem-unavailable', 'session'],
  ['ssh.exec-channel-refused', 'session'],
  ['ssh.empty-host', 'local'],
  ['ssh.empty-username', 'local'],
  ['ssh.missing-credential', 'local'],
  ['ssh.client-disconnected', 'local'],
  ['ssh.key-file-unreadable', 'local'],
]

/** 一个失败的线上形状。`message` 永远在，它是这个失败不依赖语言的那一面。 */
const wire = (code, params) => ({ code, ...(params ? { params } : {}), message: `${code} diagnostic` })

/** 有阶段、但没有「下一步」可说的码：通道开不起来是事实，不是可操作的建议。 */
const NON_ACTIONABLE = new Set(['ssh.exec-channel-refused'])

test('every code names the stage that produced it', () => {
  for (const [code, stage] of CASES) {
    assert.equal(diagnose(wire(code)).stage, stage, `误分类：${code}`)
  }
})

test('an unknown code collapses the route instead of guessing', () => {
  // 版本错位：新版后端报的码旧版界面不认识。这不是程序错误，界面仍要有一句话可读。
  const result = diagnose(wire('ssh.something-nobody-has-seen'))
  assert.equal(result.stage, null)
  assert.equal(result.breakAt, -1)
  assert.match(resolveMessage(result.title), /\S/)
  assert.equal(result.suggestion, null, '认不出来时不给下一步，而不是给一句套话')
})

test('a failure with no code keeps what it says', () => {
  // 没有码可查的失败照原文读，不塌成一句「内部错误」—— 那句话会把原因一起丢掉，
  // 而这条路径上原文往往就是唯一的线索（列表读不出来的那一行、密钥保存被拒的那一句）。
  assert.equal(errorText(new Error('invalid private key')), 'invalid private key')
  // 认不出的码同理：它自己的诊断原文好过一片空白。
  assert.equal(errorText({ code: 'ssh.nobody-has-seen-this', message: 'from a newer Host' }), 'from a newer Host')
  // 唯一被剥掉的是 Electron 给异常套的前缀，那是实现细节，不是给用户看的话。
  assert.equal(errorText(new Error("Error invoking remote method 'desktop:bootstrap': Error: rejected")), 'rejected')
})

test('every stage folds onto one of the drawn nodes', () => {
  // 画出来的是 本机 / TCP / 密钥交换 / 认证 四个节点，阶段有七个。
  // 折叠必须有人负责，否则拿 STAGES 的下标去点 DOM，TCP 失败会点亮「密钥交换」。
  assert.equal(diagnose(wire('ssh.dns-failed')).breakAt, 1, '解析失败属于 TCP 那一格')
  assert.equal(diagnose(wire('ssh.handshake-closed')).breakAt, 1, '横幅之前的事仍然是 TCP 那一格')
  assert.equal(diagnose(wire('ssh.auth-failed')).breakAt, 3)
  assert.equal(diagnose(wire('ssh.sftp-subsystem-unavailable')).breakAt, NODE_COUNT, '认证之后：四个节点全都过了')
  for (const [code] of CASES) {
    const at = diagnose(wire(code)).breakAt
    assert.ok(at >= 0 && at <= NODE_COUNT, `${code} 落在画出来的路线之外：${at}`)
  }
})

test('a connection failure carries an actionable next step', () => {
  // 建议按**类别**给：同一类失败下一步是同一件事。`cause: null` 是明说的「没有可说的
  // 下一步」，不是漏填 —— 认证之后才断的通道失败就属于这一类。
  const actionable = CASES.filter(([code]) => !NON_ACTIONABLE.has(code))
  assert.ok(actionable.length >= 15, `只剩 ${actionable.length} 条有建议，清单大概被改坏了`)
  for (const [code, stage] of actionable) {
    const result = diagnose(wire(code))
    assert.notEqual(result.suggestion, null, `${code} 得给下一步`)
    const suggestion = t(result.suggestion)
    assert.match(suggestion, /\S/, `${stage} 得给下一步，不能只是「出错了」`)
    assert.ok(suggestion.length <= 120, `${stage} 的建议太长，成了讲义：${suggestion}`)
    assert.ok(STAGES.includes(stage) && t(stageKey(stage)).length > 0, `${stage} 不是 STAGES 里的阶段`)
  }
  // 没有下一步的码是明说的，不是漏填。
  assert.equal(diagnose(wire('ssh.exec-channel-refused')).suggestion, null)
})

test('the title is a key, not a sentence, and it carries the params', () => {
  // 存句子的话，用户在失败之后切一次语言，最需要读懂的那一屏会停在上一门语言里。
  const result = diagnose(wire('ssh.timeout', { host: '10.0.0.7', port: 22 }))
  assert.equal('key' in result.title, true)
  assert.equal(resolveMessage(result.title), t('error.ssh.timeout', { host: '10.0.0.7', port: 22 }))
  assert.match(resolveMessage(result.title), /10\.0\.0\.7:22/)
})
