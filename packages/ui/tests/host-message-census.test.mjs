import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOST_ERROR_CODES } from '@pureterm/protocol'
import { NODE_COUNT, diagnose } from '../src/failure-diagnostics.ts'
import { resolveMessage } from '../src/message-text.ts'

/*
 * 宿主能报的每一个码，这里都读一遍。
 *
 * 为什么值得单独一个测试：分诊表是宿主与渲染层之间的**第二份清单**。手写它必然
 * 会写漏 —— 宿主新增一个码，页面就会把它当成「认不出来」，把一个已经说清楚的
 * 失败塌成一个点。这个测试读的是宿主源文件本身，所以漏抄、抄错、宿主新增码，
 * 都会在这里红，而不是等用户看见一条什么也没指的路线。
 */
const HOST_SRC = fileURLToPath(new URL('../../../packages/host/src/', import.meta.url))

function sourceFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (name.endsWith('.ts')) acc.push(full)
  }
  return acc
}

/** 宿主里每一种「造一个失败」的写法。`new HostError(code, …)` 传变量时正则不匹配，那是刻意的。 */
const RAISED = /new HostError\(\s*'([^']+)'|invalidFrame\(\s*'([^']+)'/g

test('every code the host can raise is declared in HOST_ERROR_CODES', () => {
  const declared = new Set(HOST_ERROR_CODES)
  const raised = new Set()
  for (const file of sourceFiles(HOST_SRC)) {
    for (const match of readFileSync(file, 'utf8').matchAll(RAISED)) raised.add(match[1] ?? match[2])
  }
  assert.ok(raised.size >= 60, `只量到 ${raised.size} 个码，大概是取码的正则失效了`)
  const undeclared = [...raised].filter(code => !declared.has(code))
  assert.deepEqual(undeclared, [], '这些码没有进 HOST_ERROR_CODES，跨线之后渲染层认不出')
})

test('every declared code is classified and always has something to say', () => {
  for (const code of HOST_ERROR_CODES) {
    const failure = diagnose({ code, message: `${code} diagnostic` })
    assert.match(resolveMessage(failure.title), /\S/, `${code} 没有一句话`)
    assert.ok(failure.breakAt >= -1 && failure.breakAt <= NODE_COUNT, `${code} 的 breakAt 越界：${failure.breakAt}`)
  }
})

test('the one code meant to be unclassifiable still collapses', () => {
  // 认不出来的连接失败是兜底：路线整条塌掉，而不是猜一段。
  const result = diagnose({ code: 'ssh.failed', message: 'kex_exchange_batch: bogus' })
  assert.equal(result.stage, null)
  assert.equal(result.breakAt, -1)
  assert.equal(result.suggestion, null)
})
