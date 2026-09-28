import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { diagnose } from '../src/failure-diagnostics.ts'

/**
 * 把 packages/host/src/services/ssh.ts 里每一句 new Error(...) 拿来问一遍分诊表。
 *
 * 为什么值得单独一个测试：failure-diagnostics 里的中文是对宿主文案的**第二次表述**，
 * 手写清单会把它写成大意而不是原文 —— 于是「主机密钥校验失败」被写成
 * 「主机密钥已改变」、私钥那两条被合并成一条，而那三句在页面上就会塌成一个点，
 * 明明宿主已经把原因说清楚了。这个测试读的是宿主源文件本身，所以抄错、漏抄、
 * 宿主新增一条文案，都会在这里红，而不是等到用户看见一个什么也没指的路线。
 */
const SOURCE = new URL('../../../packages/host/src/services/ssh.ts', import.meta.url)
const FALLBACK = /连接失败：/

test('every Chinese failure the host can raise is classifiable, except the fallback', () => {
  const raw = [...readFileSync(SOURCE, 'utf8').matchAll(/new Error\((`[^`]*`|'[^']*')\)/g)].map(m => m[1].slice(1, -1))
  // 模板串里的 ${...} 换成一个样例地址：分类只看句子本身，不看插值内容。
  const messages = raw.filter(s => /[一-龥]/.test(s)).map(s => s.replace(/\$\{[^}]*\}/g, '10.0.0.7:22'))
  assert.ok(messages.length >= 15, `只量到 ${messages.length} 条，大概是取文案的正则失效了`)
  const unclassified = messages.filter(s => !FALLBACK.test(s) && diagnose(s).stage === null)
  assert.deepEqual(unclassified, [], '这些宿主文案分诊表不认，页面会把已经说明的失败塌成一个点')
})

test('the one message meant to be unclassifiable still collapses', () => {
  const result = diagnose('10.0.0.7:22 连接失败：kex_exchange_batch: bogus')
  assert.equal(result.stage, null)
  assert.equal(result.breakAt, -1)
})
