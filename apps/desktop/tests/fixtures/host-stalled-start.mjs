import { writeFileSync } from 'node:fs'

writeFileSync(process.env.PURETERM_TEST_CHILD_PID, String(process.pid), 'utf8')
// Own the IPC channel but deliberately never acknowledge startup or shutdown.
process.on('message', () => {})
