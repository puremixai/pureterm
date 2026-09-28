import assert from 'node:assert/strict'
import test from 'node:test'
import { NODE_COUNT, STAGES, diagnose, stageLabel } from '../src/failure-diagnostics.ts'

// 这张表里的每一句中文都照抄 packages/host/src/services/ssh.ts 的
// normalizeSshError（:121-184）与它的 pre-flight 抛出（:239-252）；英文那几条是
// :183 兜底路径会原样带出来的 ssh2 文案。它们就是契约：中文那一半由
// apps/desktop/tests/smoke-host.mjs:38,53,94,97 钉着，宿主改了措辞就得在这里红一次，
// 而不是让路线安静地指错地方。
const CASES = [
  ['无法解析主机名 jump.example.com。', 'address'],
  ['无法连接 10.0.0.7:22：目标端口拒绝连接（服务未启动或被防火墙拦截）。', 'tcp'],
  ['连接 10.0.0.7:22 超时：网络不可达，或端口被丢弃。', 'tcp'],
  ['与 10.0.0.7:22 的连接被重置。', 'tcp'],
  ['SSH 连接在握手完成前已关闭。', 'handshake'],
  ['10.0.0.7:22 的 TCP 连接建立了，但对方在送出 SSH 横幅之前就断开了。', 'handshake'],
  ['主机密钥已改变，可能是中间人攻击。', 'keyexchange'],
  ['主机密钥校验失败：10.0.0.7:22 的密钥与本地记录不一致。', 'keyexchange'],
  ['Unable to negotiate with 10.0.0.7 port 22: no matching key exchange method.', 'keyexchange'],
  ['认证失败：用户名、密码或私钥不正确。', 'auth'],
  ['这把私钥有口令保护，请在「私钥口令」里填上。', 'auth'],
  ['这个文件不是可识别的私钥（支持 OpenSSH / PEM 格式），请重新选一个。', 'auth'],
  ['私钥无法解析：口令可能不对，或这不是 OpenSSH/PEM 格式的私钥。', 'auth'],
  ['Permission denied (publickey).', 'auth'],
  ['10.0.0.7:22 连上了、登录也成功了，但这台服务器没能开起 SFTP 子系统。', 'session'],
  ['Unable to start subsystem: sftp', 'session'],
  ['主机地址不能为空。', 'local'],
  ['用户名不能为空。', 'local'],
  ['缺少认证凭据：填密码、选私钥文件，或让 ssh-agent 先加载好密钥。', 'local'],
  ['客户端已断开连接。', 'local'],
]

test('every host-classified failure names the stage that produced it', () => {
  for (const [message, stage] of CASES) {
    assert.equal(diagnose(message).stage, stage, `误分类：${message}`)
  }
})

test('an unknown failure collapses the route instead of guessing', () => {
  const result = diagnose('10.0.0.7:22 连接失败：something nobody has seen before')
  assert.equal(result.stage, null)
  assert.equal(result.breakAt, -1)
  assert.match(result.title, /\S/)
})

test('every stage folds onto one of the drawn nodes', () => {
  // 画出来的是 本机 / TCP / 密钥交换 / 认证 四个节点，阶段有七个。
  // 折叠必须有人负责，否则拿 STAGES 的下标去点 DOM，TCP 失败会点亮「密钥交换」。
  assert.equal(diagnose('无法解析主机名 x。').breakAt, 1, '解析失败属于 TCP 那一格')
  assert.equal(diagnose('SSH 连接在握手完成前已关闭。').breakAt, 1, '横幅之前的事仍然是 TCP 那一格')
  assert.equal(diagnose('认证失败：用户名、密码或私钥不正确。').breakAt, 3)
  assert.equal(diagnose('Unable to start subsystem: sftp').breakAt, NODE_COUNT, '认证之后：四个节点全都过了')
  for (const [message] of CASES) {
    const at = diagnose(message).breakAt
    assert.ok(at >= 0 && at <= NODE_COUNT, `${message} 落在画出来的路线之外：${at}`)
  }
})

test('a classified failure carries an actionable next step', () => {
  for (const [message, stage] of CASES) {
    const result = diagnose(message)
    assert.match(result.suggestion, /\S/, `${stage} 得给下一步，不能只是「出错了」`)
    assert.ok(result.suggestion.length <= 120, `${stage} 的建议太长，成了讲义：${result.suggestion}`)
    assert.ok(STAGES.includes(stage) && stageLabel(stage).length > 0, `${stage} 不是 STAGES 里的阶段`)
  }
})
