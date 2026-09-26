import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { readPartials, styleImportCount } from './partial-list.mjs'

const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8')
const { manifest, groups, names, css } = await readPartials()

// Comments document, they do not declare. One assertion below has to tell a rule
// from a note about that rule — the note left where the cancelled-hairline rule
// used to be names the selector in prose — so it reads this view rather than the
// raw text. Blanking rather than deleting keeps every other offset intact. The
// shared-only view is the same blanking over style.css's partials alone, which is
// what the Web entry actually loads.
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const rules = strip(css)
const sharedRules = strip(groups[0].css)

test('the shared UI exposes the mature workspace visual contract', () => {
  assert.match(html, /<div id="app" class="app-shell">/)
  assert.match(html, /class="workspace-mark"/)
  assert.match(html, /class="workspace"/)
  assert.match(html, /<title>PureTerm<\/title>/)

  assert.match(html, /class="app-topbar"/)
  assert.match(html, /id="primary-nav"/)
  assert.match(html, /id="theme-toggle"/, 'the light theme is unreachable without this control')
  assert.match(html, /id="density-toggle"/)
  // The caption buttons are desktop-only, and this markup and app.css are what both
  // entries share — so "the Web entry does not do window buttons" can only be pinned
  // here: no node in the shared HTML, no rule in the shared cascade. The copy the
  // desktop needs lives in desktop.css, which only services/chrome.ts links, and only
  // once it has the desktop bridge.
  assert.doesNotMatch(html, /window-controls/,
    'the shared markup must not carry the caption buttons: the Web entry shares it and has no window to control')
  assert.doesNotMatch(sharedRules, /\.window-control/,
    'the shared cascade must not carry caption-button rules; desktop.css owns them')
  assert.match(html, /class="status-bar"/)
  assert.match(css, /\.status-bar\s*\{[^}]*var\(--status-h\)/, 'the status bar must be drawn from its token')
  assert.match(html, /id="host-search"/)
  // The prototype's controls the deferred pass left out. Each one is asserted
  // because the shape is what carries the decision, not the pixels: the switch
  // proxies a select, the empty state carries an action, the failure names a
  // verdict, and the status bar gained two fields the renderer already owned.
  assert.match(html, /id="auth-switch"[^>]*role="group"/, 'the authentication choice is the segmented switch, not a dropdown')
  assert.match(html, /<select id="auth" hidden>/, '#auth stays the one value the switch proxies; two sources would disagree')
  assert.match(css, /\.switch-option\[aria-pressed="true"\]/, 'the switch must be able to show which side is on')
  assert.match(html, /id="address-hint"/, 'the address row echoes the command it will run')
  assert.match(css, /\.address-hint:empty\s*\{\s*display:\s*none/, 'a hint with nothing true to say must leave rather than sit empty')
  assert.match(html, /id="hosts-empty-new"/, 'an empty state offers the next action, not only the absence')
  assert.match(css, /^kbd \{/m, 'key chips are one element rule; two component styles would drift')
  assert.match(html, /id="failure-chip"/, 'a failure names its verdict next to the words it was read from')
  assert.match(html, /id="status-session"/, 'the status bar says which session of how many')
  // 状态栏那一格的前两项填上了：协商出的 cipher 与服务端 host key 算法。它们是连接期
  // 的常量，所以归状态栏而不归每 5 秒刷一次的监控行。第三项「会话时长」仍然不在 ——
  // 快照里的是**主机**的 uptime，是另一个数字，不许拿它顶替。
  assert.match(html, /id="status-cipher"/, 'the negotiated cipher has its cell')
  assert.match(html, /id="status-key"/, 'and so does the server host key algorithm')
  assert.doesNotMatch(html, /id="status-uptime"/, 'the host uptime must not be printed as a session uptime')
  assert.match(html, /id="status-hint"/, 'and carries only the hints that are true at the time')
  assert.match(css, /#status-hint:empty\s*\{\s*display:\s*none/, 'the hint slot collapses when it has nothing to say')
  assert.match(css, /\.credential-note\s*\{[^}]*font-size:\s*var\(--fs-micro\)/, 'the credential note recedes by type, not by a box')
  assert.match(html, /id="keychain-download"/, 'a saved key can leave the vault as a .pub file')
  assert.match(css, /\.failure-raw\s*\{[^}]*var\(--font-mono\)/, 'the verdict\'s evidence is machine output')
  assert.match(css, /\.chip\.err\s*\{/, 'the verdict chip needs the error tint it is read through')
  assert.match(html, /id="connection-workspace"/)
  assert.match(html, /id="connection-failure"/)
  assert.match(html, /id="failure-log"/)
  assert.match(html, /class="drawer-scroll"/)
  assert.match(html, /class="primary drawer-connect"/)
  assert.match(html, /id="host-columns"[^>]*class="host-columns"/, 'the hosts table needs a header row to sit above the rows')
  assert.match(html, /id="keychain-columns"[^>]*class="host-columns"/, 'the key table shares that header shape')
  assert.match(css, /\.host-columns,\s*\.host-row \{[^}]*minmax\(0,1\.5fr\)/, 'the header and the rows must share one column template')
  assert.match(css, /#keychain-columns,\s*\.keychain-card \{[^}]*minmax\(0,1\.2fr\)/, 'the key table must share its template the same way')
  // The remote file table is the third one, so it shares the same discipline:
  // one template for the header and the rows, and a way to let go of the data
  // columns when the grip has dragged the pane narrower than they need.
  assert.match(css, /\.file-columns,\s*\.file-row \{[^}]*minmax\(0,1fr\) 62px 42px 74px 24px/, 'the file header and its rows must share one column template')
  assert.match(css, /@container \(max-width: 259px\)[\s\S]{0,240}minmax\(0, 1fr\) 24px/, 'the file columns must give up before they overflow the pane')
  assert.match(css, /:has\(#sftp-hint:not\(\[hidden\]\)\) #sftp-columns/, 'the file header must leave with an empty directory')
  assert.match(css, /\.file-row \.file-main \{ min-height: 0/, 'a file row must not be floored by the button inside it')
  // The failure route: four nodes, one of them red, and the break on the link
  // leading into it. Guarded as text because the DOM is static markup here and a
  // deleted state class would only show up as a page that points nowhere.
  assert.match(html, /class="failure-route"[^>]*aria-hidden="true"/, 'the route is decoration alongside the words, not a second announcement')
  assert.equal((html.match(/data-stage=/g) || []).length, 4, 'the route draws exactly four nodes')
  assert.match(css, /\.failure-route-node\.is-failed/, 'the route must be able to mark one node')
  assert.match(css, /\.failure-route-line\.is-break/, 'and break the link where it died')
  assert.doesNotMatch(css, /\.failure-route-node\s*\{[^}]*var\(--err\)/, 'no node may be red just for existing')
  assert.match(css, /\.failure-host \.host-avatar\s*\{[^}]*var\(--r-2\)/, 'the failure mark is a 34px square at the row radius, not a 58px badge')
  assert.doesNotMatch(css, /border-radius:\s*999px/, '--r-full exists; do not re-invent it')
  assert.match(css, /\.failure-log-no\s*\{[^}]*user-select:\s*none/, 'line numbers must not ride along into a pasted log')
  assert.match(css, /\.failure-log\s*\{[^}]*var\(--font-mono\)/, 'the log is machine output and should look like it')
  // Toasts: the mount point, the layer, and a bottom offset that follows the
  // status bar instead of copying its height.
  assert.match(html, /id="toasts" class="toasts" aria-live="polite"/, 'toasts need their mount point or ClientToasts never boots')
  assert.match(css, /\.toasts\s*\{[^}]*var\(--z-toast\)/, 'the toast layer draws its own z-index token')
  assert.match(css, /\.toasts\s*\{[^}]*calc\(var\(--status-h\)/, 'and clears the status bar by construction, not by a literal')
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.toast\s*\{\s*animation:\s*none/, 'a notice that slides must be able to stop sliding')
  // A card is the same row with its columns folded away — all but the address,
  // which is the one thing a name cannot stand in for.
  assert.match(css, /\.card-view \.host-row \.host-cell \{ display: none/, 'a card must not repeat the table columns')
  assert.match(css, /\.card-view \.host-row \.host-cell\.mono \{ display: block/, 'and a card keeps the address it is a name for')
  // A header over an empty table frames nothing. Both screens already toggle the
  // empty element's hidden attribute, so the header follows that rather than a
  // second copy of the count.
  assert.match(css, /:has\(#hosts-empty:not\(\[hidden\]\)\) #host-columns/, 'the hosts header must leave with an empty list')
  assert.match(css, /:has\(#keychain-empty:not\(\[hidden\]\)\) #keychain-columns/, 'and so must the key header')
  // base.css floors every button at 28px, which is under --row-h: un-flooring
  // the row's own button is what makes the density switch change a row at all.
  assert.match(css, /#host-list:not\(\.card-view\) \.host-main \{ min-height: 0/, 'a table row must be allowed to shrink below the button floor')
  assert.match(css, /\.keychain-list:not\(\.card-view\) \.keychain-card-main \{ min-height: 0/, 'and so must a key row')
  assert.match(html, /class="ti ti-server-2"/)
  assert.match(manifest, /@import\s+"@tabler\/icons-webfont\/dist\/tabler-icons\.min\.css"/)

  // Token existence belongs to design-tokens.test.mjs, which reads the theme
  // groups themselves, and so does "every var() names a declared token", which
  // stylesheet-contract.test.mjs measures. Nothing is asserted here that one of
  // those two already covers.

  assert.match(css, /:focus-visible\s*\{/, 'keyboard focus treatment is required')
  assert.match(css, /#main\s*\{[^}]*display:\s*grid/, 'the workspace column must be a grid so it can hand its own column to the editor')
  assert.match(css, /\.app-shell\.inspector-open\s+#main\s*\{[^}]*var\(--insp-w\)/, 'the docked editor must be a track of the workspace column, not an overlay')
  // The split is one mechanism. #sftp used to be an absolutely positioned drawer
  // AND a grid child of .session-content, and only the second one could ever be
  // seen — .files-open is what shows the panel at all.
  assert.match(css, /\.session-content\s*\{[^}]*grid-template-columns:/, 'the session content is a column grid')
  // 监控条永远不参与拉伸，终端那一格才是弹性的：一条读数横带从终端高度里扣，
  // 而它自己不该跟着窗口一起长。
  assert.match(css, /\.session-monitor\s*\{[^}]*flex:\s*0 0 auto/, 'the monitor never takes a share of the terminal height')
  assert.match(css, /\.session-content\s*\{[^}]*flex:\s*1 1 auto[^}]*min-height:\s*0/, 'the content stays the flexible, shrinkable one')
  assert.match(css, /\.files-open \.session-content\s*\{[^}]*var\(--grip-w\)/, 'the grip is its own track, not an overlay on one')
  assert.doesNotMatch(css, /#sftp\s*\{[^}]*position:\s*absolute/, 'one element may not have two layout mechanisms')
  // Two columns at their minimum floors are 465px, which no phone-width window
  // holds; the narrow case stacks and must keep saying so.
  assert.match(css, /grid-template-rows:\s*minmax\(120px, 1\.35fr\) var\(--grip-w\) minmax\(160px, 1fr\)/, 'below 820 the file table stacks under the terminal')
  // .app-body holds the rail and one workspace column and nothing else. An
  // --insp-w track there is an empty third column, and the editor — a child of
  // #main — stays below the fold of a column it never narrows.
  assert.doesNotMatch(css, /\.app-shell\.inspector-open\s+\.app-body/, 'the editor track belongs to #main, which is its actual grid container')
  assert.match(css, /\.connection-failure\s*\{/, 'connection failures need a dedicated visual state')
  // A session narrows the content column; it does not take the shell apart. The
  // rule this replaces hid #primary-nav and collapsed .app-body to one track,
  // which made a connected screen look like the frame had been lost — the
  // prototype's shell is rail + main (+ inspector) on every screen it draws.
  assert.doesNotMatch(rules, /session-mode/, 'the rail stays through a session: the shell keeps its 52px track, as the prototype draws it')
  assert.match(css, /@media\s*\(max-width:\s*620px\)/, 'narrow layouts need an explicit mobile fallback')
})

// The control scale is the whole point of this alignment: the prototype's 28px
// button, 28px field and --r-1 corner are what every screen inherits, and they
// are the one thing a later "chunky" pass would quietly undo. Nothing else in
// this suite reads a px height, so this is the guard that would have caught the
// drift the alignment exists to remove.
test('the control language is the prototype\'s 28px scale', async () => {
  const { names, texts } = await readPartials()
  const partial = (name) => {
    assert.notEqual(names.indexOf(name), -1, `styles/${name}.css is part of this contract`)
    return texts[names.indexOf(name)]
  }
  assert.match(partial('base'), /button \{[^}]*min-height: 28px/, 'the base button is the prototype\'s .btn')
  assert.match(partial('base'), /button \{[^}]*border-radius: var\(--r-1\)/, 'and takes the control corner, not the card one')
  assert.match(partial('base'), /button\.small \{[^}]*min-height: 24px/, 'a small button is one step under it')
  assert.match(partial('base'), /textarea \{[^}]*min-height: 62px/, 'a textarea is the prototype\'s .ta')
  assert.match(partial('inspector'), /input, select \{[^}]*height: 28px/, 'a field is the same 28px as the button beside it')
  assert.match(partial('inspector'), /input, select \{[^}]*border-radius: var\(--r-1\)/, 'and the same corner')
  // --r-4 (12px) is unused after this change. The prototype's ladder is --r-1 for
  // controls, --r-2 for rows and banners, --r-3 for the dialog, and it never draws
  // a 12px corner. A declaration that reaches for it is the old language returning,
  // which is why this reads declarations rather than the whole text: the comments
  // that explain the ladder are allowed to name it.
  const offenders = names
    .filter((name) => name !== 'tokens')
    .flatMap((name) => texts[names.indexOf(name)].split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => /border-radius:[^;]*var\(--r-4\)/.test(line))
      .map(([line]) => `  styles/${name}.css:${line}`))
  assert.deepEqual(offenders, [], `--r-4 is not on this ladder:\n${offenders.join('\n')}`)
})

// The four rearrangements that are structure, not pixels. Each is asserted
// through the markup because a CSS-only check cannot see a parent, and each is
// what makes the screens read as one header row instead of three stacked ones.
test('the prototype\'s rearrangements are in the markup', () => {
  const head = /<div class="page-head">([\s\S]*?)<\/div>\s*\n\s*<p id="hosts-error"/.exec(html)
  assert.ok(head, 'the hosts page header is one .page-head row')
  assert.match(head[1], /id="host-search"/, 'the search box sits in that row, not on a row of its own')
  assert.match(head[1], /id="host-new"/, 'and so does the primary action')
  assert.match(html, /class="page-head keychain-head"/,
    'the keychain header is the same row, not an 86px toolbar plus a second heading inside the content')

  // 会话栏和内容之间现在夹着监控条的挂载点，所以这条模式放宽到「只允许那个挂载点
  // 夹在中间」。它要证的仍然是同一件事——会话栏就是内容上面那一块——而不是被删掉。
  // 挂载点本身也断言：它出厂是空的，子节点归 services/monitor.ts。
  const toolbar = /<div class="session-toolbar">([\s\S]*?)<\/div>\s*\n\s*(?:<!--[\s\S]*?-->\s*\n\s*)?<div id="session-monitor" class="session-monitor"><\/div>\s*\n\s*<div class="session-content">/.exec(html)
  assert.ok(toolbar, 'the session toolbar is still one block above the session content')
  assert.match(toolbar[1], /id="failure-chip"/, 'the failure verdict lives in the session toolbar')
  assert.match(toolbar[1], /id="failure-raw"/, 'and so does the line it was read from')
  assert.doesNotMatch(html, /class="failure-verdict"/, 'the failure page no longer carries its own verdict row')

  // The top-left brand: mark, name and the area it is showing on one line, the
  // way the prototype's .brand draws it. Two traps are asserted here because
  // both were live before: a column stacks the name over the area (measured
  // 28.3px tall against the prototype's 18px), and a min-width wider than the
  // content lets the button centre itself and shove the mark 34px off the left
  // edge. The area is a node rather than part of the <strong> because the
  // prototype names a different one per screen (/ Vault, / Session).
  assert.match(html, /<small id="workspace-area">\/ Vault<\/small>/,
    'the brand reads PureTerm / Vault on one line, and the area is a node the renderer can rewrite')
  const copy = /\.workspace-copy\s*\{([^}]*)\}/.exec(css)
  assert.ok(copy, 'chrome.css must carry the .workspace-copy rule')
  assert.doesNotMatch(copy[1], /flex-direction:\s*column/, 'the brand is one line; a column stacks the name over the area again')
  assert.match(copy[1], /align-items:\s*center/, 'the name and the area share one row')
  const switcher = /\.workspace-switcher\s*\{([^}]*)\}/.exec(css)
  assert.ok(switcher, 'chrome.css must carry the .workspace-switcher rule')
  assert.doesNotMatch(switcher[1], /min-width/,
    'a min-width wider than the content makes the button centre itself and pushes the mark off the top bar\'s 12px edge')
  assert.match(css, /\.workspace-copy small \{[^}]*font-weight:\s*400/,
    'the area sits in a <button>, so it inherits base.css\'s 500 unless it says 400 itself')

  // The strip holds session tabs only. The library used to hang a "Hosts" tab in
  // it, which said the same thing as the brand's / Vault, and which was the only
  // active tab in the bar whose --line border a later, equal-specificity rule
  // cancelled — so the prototype's .tab.on outline was missing. With the tab
  // gone the rail (#nav-hosts) and the brand (#workspace-home) are the two ways
  // back to the library, and both already existed.
  assert.doesNotMatch(html, /id="hosts-tab"/,
    'the library must not carry a tab: / Vault names the screen and the rail switches pages')
  assert.doesNotMatch(html, /id="library-tab-title"/,
    'nothing may write a library title into the strip either')
  assert.doesNotMatch(html, /aria-labelledby="hosts-tab"/,
    'no element may still point at the removed tab')
  assert.match(html, /<div id="workspace-tabs" class="workspace-tabs" role="tablist" aria-label="会话标签"><\/div>/,
    'the strip ships empty and services/terminal.ts appends session tabs to it')
  assert.doesNotMatch(rules, /\.workspace-tabs > \.app-tab/,
    'the rule that cancelled the active tab\'s hairline has no subject left; keeping it would re-arm the bug')

  assert.match(html, /id="hosts-empty" class="empty-state"/, 'the page-level empty state is the prototype\'s .es box')
  assert.match(css, /\.empty \{/, 'and .empty stays: the file table needs the compact variant')
})

test('each manifest imports its own partials exactly once, and the cascade order holds', async () => {
  const { groups, names, texts } = await readPartials()
  const [shared, desktop] = groups
  assert.equal(shared.name, 'style.css')
  assert.equal(desktop.name, 'desktop.css')
  assert.deepEqual(shared.names, ['fonts', 'tokens', 'base', 'chrome', 'hosts', 'inspector', 'keychain', 'terminal', 'states'],
    'cascade order is load-bearing; change it only with a measured cascade check')
  // The second manifest exists for exactly one sheet. If it grew a second partial the
  // question to ask is whether that sheet belongs to both entries; if it does, it
  // belongs in style.css where the Web entry loads it too.
  assert.deepEqual(desktop.names, ['window-controls'],
    'desktop.css carries only the sheet the standalone Web entry must not load')
  for (const group of groups) {
    assert.equal(styleImportCount(group.manifest), group.names.length,
      `every @import of a styles/*.css partial in ${group.name} must yield a name; a form the parser drops would slip the file out of the contract`)
  }
  const seen = new Set()
  for (const name of names) {
    assert.equal(seen.has(name), false, `${name} is imported twice, and across two manifests that would be worse than within one`)
    seen.add(name)
  }
  for (const [name, text] of names.map((n, i) => [n, texts[i]])) {
    assert.ok(!/@import/.test(text), `styles/${name}.css must not @import; put it in style.css or desktop.css`)
  }
})

const SOURCE_ROOT = new URL('../src/', import.meta.url)

async function sourceTexts(directory = SOURCE_ROOT, prefix = '') {
  const files = new Map()
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) for (const [name, text] of await sourceTexts(path, `${prefix}${entry.name}/`)) files.set(name, text)
    else if (/\.ts$/.test(entry.name)) files.set(prefix + entry.name, await readFile(path, 'utf8'))
  }
  return files
}

// ClientMonitor 是这条流水线的终点，不是任何东西的依赖。这一条读源文件本身，因为
// 「谁的 inject 列表里有它」在运行时看不见：一次错误的注入会在卸载监控时顺手拆掉
// 别的插件，而那一刻页面只是少了一格数字，没人会把它和一行 inject 联系起来。
test('the monitor plugin is a leaf: only the workspace depends on it', async () => {
  const files = await sourceTexts()
  const named = [...files].filter(([, text]) => text.includes('clientMonitor')).map(([name]) => name)
  assert.deepEqual(named, ['features/monitor.ts'],
    'the service name may only be declared by the plugin itself; another mention is a dependency on it')
  // 视图助手不认识 transport、不跑定时器、不做会话策略：它拿到的是一个状态对象，
  // 于是「这一行怎么画」和「什么时候该订阅」可以各自被证明。
  const panel = files.get('monitor-panel.ts')
  assert.ok(panel, 'monitor-panel.ts must exist')
  assert.ok(!/setInterval|setTimeout|requestAnimationFrame/.test(panel), 'the view helper runs no timers')
  assert.ok(!/SshApi|clientTransport|api\.monitor/.test(panel), 'the view helper knows no transport')

  const injectOf = (name) => {
    const match = /static inject = \[([^\]]*)\]/.exec(files.get(name) ?? '')
    // 没有 inject 列表的服务（例如 ClientView）返回空数组：下面那两条断言仍然会
    // 在列表缺失时红，因为它们比对的是确切内容。
    return match ? [...match[1].matchAll(/'([^']+)'/g)].map(found => found[1]) : []
  }
  assert.deepEqual(injectOf('features/monitor.ts'), ['clientView', 'clientTransport', 'clientTerminal'],
    'ClientMonitor injects exactly its three providers, in activation order')
  // 状态栏那两格归 ClientChrome，而它取事实的路径是 transport 本身，不是监控插件：
  // 卸载监控不能让已经协商好的 cipher 和 host key 一起消失。
  assert.ok(injectOf('services/chrome.ts').includes('clientTransport'),
    'ClientChrome reads the handshake facts from the transport, not through the monitor')
  for (const [name, text] of files) {
    if (!/extends Service/.test(text)) continue
    assert.ok(!injectOf(name).includes('clientMonitor'), `${name} must not depend on the monitor`)
  }
})
