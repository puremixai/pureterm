# Bug list

[中文版本](bug-list_zh.md)

Open issues found while using the app. This is a working checklist, not a release tracker; the dated records under [`docs/superpowers/`](superpowers/) remain the historical record of decisions.

- [x] **Hosts page — the column header in card view.** The header row is hidden when the list is switched to card view; the table view keeps it.
- [x] **Hosts page — card layout.** The card grid fits as many cards as the panel allows instead of three fixed columns, so a lone card no longer stretches across a third of the window.
- [x] **Library cards — the card interior.** Both card views borrowed the table's data cell — the host address, the key fingerprint — and a cell is a row of the card's grid, so it sat under the avatar instead of on the name's left edge: 72px off on the hosts card, flush against the card's edge on the key card. Each is a line of the name column now, and the host address reads as the connection string, so the avatar, the name and the value form one block.
- [x] **Theme switching — terminal colors.** The terminal follows the theme: the light group has its own canvas, text colours and ANSI palette, and every open terminal is re-coloured when the switch is used.
- [ ] **No single set of UI strings.** Chinese and English are mixed across the interface. The UI needs internationalization.
