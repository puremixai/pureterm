import assert from 'node:assert/strict'
import test from 'node:test'
import { withoutBootstrapToken } from '../src/bootstrap-url.ts'

test('consumed bootstrap tokens are removed while smoke parameters and hash remain', () => {
  const result = new URL(withoutBootstrapToken('http://127.0.0.1:1234/?token=secret&smoke=1&view=terminal&token=other#files'))
  assert.equal(result.searchParams.has('token'), false)
  assert.equal(result.searchParams.get('smoke'), '1')
  assert.equal(result.searchParams.get('view'), 'terminal')
  assert.equal(result.hash, '#files')
  assert.equal(result.origin, 'http://127.0.0.1:1234')
})

test('a page without a bootstrap token does not require a history update', () => {
  assert.equal(withoutBootstrapToken('http://127.0.0.1:1234/?smoke=1#files'), undefined)
})
