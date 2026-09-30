import assert from 'node:assert/strict'
import test from 'node:test'
import { startFakeSshServer } from './fake-ssh-server.mjs'
import { connection, hostFixture, rejectedWith } from './integration-helpers.mjs'

const allBytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index))

async function fixture(t) {
  const server = await startFakeSshServer({
    greeting: false,
    files: {
      '/home/demo/z-dir': null,
      '/home/demo/a-dir': null,
      '/home/demo/a-dir/nested.txt': 'keep me',
      '/home/demo/B.txt': 'B',
      '/home/demo/a.bin': allBytes,
      '/home/demo/中文.txt': '第一行\n第二行\n',
      '/home/demo/too-big.bin': Buffer.alloc(4 * 1024 * 1024 + 1),
    },
    symlinks: { '/home/demo/link-dir': '/home/demo/a-dir', '/home/demo/link-file': '/home/demo/a.bin' },
  })
  t.after(() => server.close())
  const { host } = await hostFixture(t)
  const { sessionId } = await host.openTerminal(connection(server))
  return { server, host, sessionId }
}

test('real SFTP lists canonical home paths, sorts directories first, and reads binary and Unicode files', { timeout: 15000 }, async (t) => {
  const { host, sessionId } = await fixture(t)
  const listing = await host.sftpList(sessionId, '~')
  assert.equal(listing.path, '/home/demo')
  assert.equal(listing.parent, '/home')
  assert.deepEqual(listing.entries.map((item) => item.name), ['a-dir', 'link-dir', 'z-dir', 'a.bin', 'B.txt', 'link-file', 'too-big.bin', '中文.txt'])
  const link = listing.entries.find((item) => item.name === 'link-dir')
  assert.equal(link.isDirectory, true)
  assert.equal(link.isSymlink, true)
  assert.equal(link.path, '/home/demo/link-dir')
  const bytes = await host.sftpRead(sessionId, '~/link-file')
  assert.deepEqual(Buffer.from(bytes.bytes), allBytes)
  assert.equal(bytes.size, 256)
  assert.equal(bytes.path, '/home/demo/a.bin')
  assert.equal(Buffer.from((await host.sftpRead(sessionId, './中文.txt')).bytes).toString('utf8'), '第一行\n第二行\n')
  assert.equal((await host.sftpList(sessionId, '/')).parent, null)
})

test('SFTP writes only the supplied byte view, overwrites files, creates directories, and removes links without targets', { timeout: 15000 }, async (t) => {
  const { server, host, sessionId } = await fixture(t)
  await host.sftpMkdir(sessionId, '.', '新目录')
  const backing = Buffer.concat([Buffer.from([99, 98]), allBytes, Buffer.from([97])])
  const result = await host.sftpWrite(sessionId, './新目录', '上传.bin', backing.subarray(2, 258))
  assert.deepEqual(result, { path: '/home/demo/新目录/上传.bin', size: 256 })
  assert.deepEqual(server.files.dataOf(result.path), allBytes)
  assert.deepEqual(Buffer.from((await host.sftpRead(sessionId, result.path)).bytes), allBytes)
  await host.sftpWrite(sessionId, './新目录', '上传.bin', new Uint8Array([0, 255]))
  assert.deepEqual(server.files.dataOf(result.path), Buffer.from([0, 255]))
  await host.sftpRemove(sessionId, result.path)
  await host.sftpRemove(sessionId, './新目录')
  assert.equal(server.files.exists(result.path), false)
  assert.equal(server.files.exists('/home/demo/新目录'), false)
  await host.sftpRemove(sessionId, './link-dir')
  await host.sftpRemove(sessionId, './link-file')
  assert.equal(server.files.exists('/home/demo/link-dir'), false)
  assert.equal(server.files.exists('/home/demo/link-file'), false)
  assert.equal(server.files.isDir('/home/demo/a-dir'), true)
  assert.deepEqual(server.files.dataOf('/home/demo/a.bin'), allBytes)
})

test('SFTP rejects traversal names, oversized transfers, missing files, and nonempty directory removal', { timeout: 15000 }, async (t) => {
  const { server, host, sessionId } = await fixture(t)
  for (const name of ['../escape', '/absolute', '.', '..', '']) {
    await assert.rejects(host.sftpWrite(sessionId, '.', name, allBytes), rejectedWith('sftp.bad-name'))
    await assert.rejects(host.sftpMkdir(sessionId, '.', name), rejectedWith('sftp.bad-name'))
  }
  await assert.rejects(host.sftpRead(sessionId, './missing'), rejectedWith('sftp.no-such-file'))
  await assert.rejects(host.sftpRead(sessionId, './a-dir'), rejectedWith('sftp.is-directory'))
  await assert.rejects(host.sftpRead(sessionId, './too-big.bin'), rejectedWith('sftp.download-too-large'))
  await assert.rejects(host.sftpWrite(sessionId, '.', 'too-big-upload', Buffer.alloc(4 * 1024 * 1024 + 1)), rejectedWith('sftp.upload-too-large'))
  await assert.rejects(host.sftpWrite(sessionId, './missing', 'upload', allBytes), rejectedWith('sftp.no-such-directory'))
  await assert.rejects(host.sftpRemove(sessionId, './a-dir'), rejectedWith('sftp.remove-failed'))
  await assert.rejects(host.sftpRemove(sessionId, '/'), rejectedWith('sftp.no-such-path'))
  assert.equal(server.files.exists('/home/escape'), false)
  assert.equal(server.files.exists('/home/demo/too-big-upload'), false)
  assert.equal(server.files.dataOf('/home/demo/a-dir/nested.txt').toString(), 'keep me')
})

test('concurrent SFTP consumers share one subsystem and closed sessions reject further work', { timeout: 15000 }, async (t) => {
  const { server, host, sessionId } = await fixture(t)
  const [listing, read] = await Promise.all([host.sftpList(sessionId, '.'), host.sftpRead(sessionId, './a.bin')])
  assert.equal(listing.path, '/home/demo')
  assert.deepEqual(Buffer.from(read.bytes), allBytes)
  assert.equal(server.sftp.channels, 1)
  host.close(sessionId)
  await assert.rejects(host.sftpRead(sessionId, './a.bin'), rejectedWith('ssh.session-gone'))
})
