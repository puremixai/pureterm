import assert from 'node:assert/strict'
import test from 'node:test'
import { readPartials } from './partial-list.mjs'

// tokens.css holds the new ramp and legacy.css holds the debt register; both
// are the sanctioned homes for a colour literal. Every other partial must
// resolve colour through a token, which is what makes the debt permanent.
const EXEMPT = new Set(['tokens', 'legacy'])
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/

test('no partial hard-codes a colour', async () => {
  const { names, texts } = await readPartials()
  const reports = []
  for (const [name, text] of names.map((n, i) => [n, texts[i]])) {
    if (EXEMPT.has(name)) continue
    const offenders = text.split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => !line.trim().startsWith('/*') && LITERAL.test(line))
    if (offenders.length) {
      reports.push(`styles/${name}.css\n` + offenders.map(([n, l]) => `  ${n}: ${l.trim()}`).join('\n'))
    }
  }
  assert.equal(reports.length, 0, `colours must resolve through tokens:\n\n${reports.join('\n\n')}`)
})
