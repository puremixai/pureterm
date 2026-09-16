import { existsSync, lstatSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const application = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const dist = resolve(application, 'dist')
if (dirname(dist) !== application || dist !== join(application, 'dist')) throw new Error('Refusing to clean outside application dist')
if (existsSync(dist)) {
  if (lstatSync(dist).isSymbolicLink() || realpathSync(dist) !== dist) throw new Error('Refusing to clean a redirected dist directory')
  rmSync(dist, { recursive: true, force: true })
}
console.log('ok  cleaned application dist')
