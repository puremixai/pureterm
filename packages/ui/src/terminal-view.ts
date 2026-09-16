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
    theme: { background: '#12151b', foreground: '#d7dce5', cursor: '#7fe3ff', selectionBackground: '#2f3b4d' },
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
