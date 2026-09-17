import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

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
  const terminal = new Terminal({
    cursorBlink: true, fontSize: 14, lineHeight: 1.2, scrollback: 5000,
    fontFamily: 'Cascadia Mono, Consolas, "Sarasa Mono SC", "Microsoft YaHei Mono", monospace',
    theme: {
      background: '#121426', foreground: '#d6dee8', cursor: '#69c8f4', cursorAccent: '#121426',
      selectionBackground: '#24445a', black: '#0b0e12', brightBlack: '#667382',
      white: '#d6dee8', brightWhite: '#eef3f8', blue: '#69c8f4', brightBlue: '#9bdeff',
      green: '#68d5a1', brightGreen: '#8ee8bc', yellow: '#e5bd75', brightYellow: '#f0cf8d',
      red: '#ff8e8e', brightRed: '#ffb2b2', magenta: '#c6a8ff', brightMagenta: '#dfcbff',
      cyan: '#69c8f4', brightCyan: '#a5e6ff',
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
