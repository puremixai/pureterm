# Bug list

[中文版本](bug-list_zh.md)

Open issues found while using the app. This is a working checklist, not a release tracker; the dated records under [`docs/superpowers/`](superpowers/) remain the historical record of decisions.

- [x] **Hosts page — the column header in card view.** The header row is hidden when the list is switched to card view; the table view keeps it.
- [x] **Hosts page — card layout.** The card grid fits as many cards as the panel allows instead of three fixed columns, so a lone card no longer stretches across a third of the window.
- [x] **Library cards — the card interior.** Both card views borrowed the table's data cell — the host address, the key fingerprint — and a cell is a row of the card's grid, so it sat under the avatar instead of on the name's left edge: 72px off on the hosts card, flush against the card's edge on the key card. Each is a line of the name column now, and the host address reads as the connection string, so the avatar, the name and the value form one block.
- [x] **Theme switching — terminal colors.** The terminal follows the theme: the light group has its own canvas, text colours and ANSI palette, and every open terminal is re-coloured when the switch is used.
- [x] **No single set of UI strings.** The interface was a mix of Chinese and English. Every string the page, the Electron shell, or a failure message can produce now resolves through one catalog in `@pureterm/i18n`, English is the source language and the default, and a third top-bar switch beside the theme and density toggles moves the screen between English and Chinese and is remembered. A failure crosses the wire as a code rather than a sentence, so the side that knows the language is the side that says it, and a missing translation fails the build instead of rendering blank. Developer log lines and the standalone Web CLI's own text stay English and stay out of the catalog, because neither has a switch to reach them with.
