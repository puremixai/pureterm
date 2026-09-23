import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ITheme } from '@xterm/xterm'

export interface TerminalView {
  readonly cols: number
  readonly rows: number
  write(data: string | Uint8Array): void
  focus(): void
  fit(): void
  text(): string
  onData(listener: (data: string) => void): { dispose(): void }
  onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void }
  dispose(): void
}

export type TerminalFactory = (container: HTMLElement) => TerminalView

export const createTerminalView: TerminalFactory = (container) => {
  const probe = document.documentElement
  const read = (name: string) => getComputedStyle(probe).getPropertyValue(name).trim()

  const ANSI: string[] = [
    '#08090a', '#f2555a', '#4ec27f', '#e0a83c', '#5aaeff', '#c58aff', '#57c8d0', '#b9bec6',
    '#565b63', '#ff7b81', '#7ddba8', '#f2c86f', '#7cc0ff', '#d9a8ff', '#7fe0e8', '#f2f3f5',
  ]
  // xterm's ITheme names the sixteen palette entries individually and folds
  // them into its own 0-15 array, so the neutral set above is handed over by
  // position: 0-7 normal, 8-15 bright, in black/red/green/yellow/blue/magenta/
  // cyan/white order. An `ANSI` key on the theme is rejected by the types.
  const palette: ITheme = {
    black: ANSI[0], red: ANSI[1], green: ANSI[2], yellow: ANSI[3],
    blue: ANSI[4], magenta: ANSI[5], cyan: ANSI[6], white: ANSI[7],
    brightBlack: ANSI[8], brightRed: ANSI[9], brightGreen: ANSI[10], brightYellow: ANSI[11],
    brightBlue: ANSI[12], brightMagenta: ANSI[13], brightCyan: ANSI[14], brightWhite: ANSI[15],
  }

  const terminal = new Terminal({
    cursorBlink: true, fontSize: 14, lineHeight: 1.2, scrollback: 5000,
    fontFamily: 'Cascadia Mono, Consolas, "Sarasa Mono SC", "Microsoft YaHei Mono", monospace',
    theme: {
      background: read('--term-bg'),
      foreground: read('--term-fg'),
      cursor: read('--term-cursor'),
      cursorAccent: read('--term-bg'),
      selectionBackground: read('--term-selection'),
      ...palette,
    },
  })
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  terminal.open(container)
  return {
    get cols() { return terminal.cols },
    get rows() { return terminal.rows },
    write: (data) => terminal.write(data),
    focus: () => terminal.focus(),
    fit: () => fit.fit(),
    onData: (listener) => terminal.onData(listener),
    onResize: (listener) => terminal.onResize(listener),
    text() {
      const buffer = terminal.buffer.active
      const lines: string[] = []
      for (let index = 0; index < buffer.length; index++) lines.push(buffer.getLine(index)?.translateToString(true) ?? '')
      return lines.join('\n')
    },
    dispose: () => terminal.dispose(),
  }
}
