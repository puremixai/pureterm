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
  /**
   * Re-read the terminal tokens. xterm resolves a theme once, so a switch that
   * only rewrote `data-theme` would leave every open terminal on the group it
   * was built in; the client calls this for each pane when the theme changes.
   */
  applyTheme(): void
  onData(listener: (data: string) => void): { dispose(): void }
  onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void }
  dispose(): void
}

export type TerminalFactory = (container: HTMLElement) => TerminalView

export const createTerminalView: TerminalFactory = (container) => {
  const probe = document.documentElement
  const read = (name: string) => getComputedStyle(probe).getPropertyValue(name).trim()

  // Entry 0 is deliberately not --term-bg: identical values would make
  // black-on-terminal text exactly 1.00:1 by construction. brightBlack clears
  // 3:1 because prompts use it for dimmed rather than hidden text.
  const ANSI_DARK: string[] = [
    '#101317', '#f2555a', '#4ec27f', '#e0a83c', '#5aaeff', '#c58aff', '#57c8d0', '#b9bec6',
    '#5f656e', '#ff7b81', '#7ddba8', '#f2c86f', '#7cc0ff', '#d9a8ff', '#7fe0e8', '#f2f3f5',
  ]
  // The light palette is its own set, not the dark one at another alpha: on a
  // white canvas every entry has to stay dark enough to read, so "bright" means
  // more saturated rather than lighter. Entry 0 is a legible near-black here —
  // the shadow step of a white canvas would be invisible text — and six entries
  // mirror the light group's own tokens. brightBlue is deliberately *not*
  // --ac-hi: that token is the darker hover step of the light group, and
  // brightBlue has to stay the lighter blue.
  const ANSI_LIGHT: string[] = [
    '#24292f', '#b83237', '#187747', '#8c6009', '#1f6feb', '#8250df', '#0f6f77', '#454b54',
    '#6b7280', '#d1242f', '#1a7f37', '#9a6700', '#218bff', '#a475f9', '#1b7c83', '#16181c',
  ]
  // xterm's ITheme names the sixteen palette entries individually and folds
  // them into its own 0-15 array, so a list is handed over by position: 0-7
  // normal, 8-15 bright, in black/red/green/yellow/blue/magenta/cyan/white
  // order. An `ANSI` key on the theme is rejected by the types.
  const palette = (entries: string[]): ITheme => ({
    black: entries[0], red: entries[1], green: entries[2], yellow: entries[3],
    blue: entries[4], magenta: entries[5], cyan: entries[6], white: entries[7],
    brightBlack: entries[8], brightRed: entries[9], brightGreen: entries[10], brightYellow: entries[11],
    brightBlue: entries[12], brightMagenta: entries[13], brightCyan: entries[14], brightWhite: entries[15],
  })
  // The four canvas tokens resolve per theme on their own, because
  // getComputedStyle answers for the group that is on. Only the palette has to
  // be chosen, and `data-theme` is the theme switch's single source for which
  // group that is.
  const themeOf = (): ITheme => ({
    background: read('--term-bg'),
    foreground: read('--term-fg'),
    cursor: read('--term-cursor'),
    cursorAccent: read('--term-bg'),
    selectionBackground: read('--term-selection'),
    ...palette(probe.dataset.theme === 'light' ? ANSI_LIGHT : ANSI_DARK),
  })

  const terminal = new Terminal({
    cursorBlink: true, fontSize: 14, lineHeight: 1.2, scrollback: 5000,
    // --font-term carries exactly the stack this line used to hard-code, so the
    // family list is unchanged. fontSize stays 14 and --fs-term stays unread:
    // 13.5px would change xterm's measured cell metrics without a re-measure.
    fontFamily: read('--font-term'),
    theme: themeOf(),
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
    // xterm's ThemeService watches this one option, so the assignment is what
    // repaints the canvas, the palette and the cursor in place.
    applyTheme: () => { terminal.options.theme = themeOf() },
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
