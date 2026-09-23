# Standalone Local Web Entry

[中文版本](README_zh.md)

PureTerm’s local Web entry runs Node on the user’s computer, and a browser connects to that same computer. The Node process manages SSH, SFTP, host information, and trusted host keys. Web and Desktop use the same `@pureterm/transport/web-host` assembly with separate data directories and credential policies. Web also shares `@pureterm/host`, `@pureterm/protocol`, and `@pureterm/ui`; its runtime does not require Electron.

Install dependencies at the repository root and start the entry point. The command builds shared modules and the Web entry:

```powershell
npm ci
npm run start:web
```

When artifacts are already built, run ordinary Node directly:

```powershell
node apps/web/dist/main.js
```

Startup prints a tokenized URL to open in a browser on the same computer. The server binds only to a random available port on `127.0.0.1` by default and does not open a browser automatically. Press Ctrl+C to stop; closing the page releases the SSH sessions belonging to that page.

```powershell
node apps/web/dist/main.js --port 8787 --data-dir D:\PureTerm\web-data
node apps/web/dist/main.js --help
```

Set the data directory with `SSH_CORDIS_WEB_DATA_DIR`; `--data-dir` takes precedence. The default is `~/.ssh-cordis/web`, separate from Desktop’s existing data directory so that two independent processes never write the same host or credential files.

Web stores host information and trusted SSH host keys and never creates or reads `secrets.json` or the Desktop `keychain.json` vault. Passwords, private-key passphrases, and private-key content exist only in the current client session and must be supplied again after a refresh. Keychain supports import, paste, editing, search, and host selection using per-client Host memory; keys and host-key associations are cleared on disconnect and never serialized to disk. The browser File API reads private-key content; the browser never exposes the complete local file path to the server. Desktop supports native file selection and system-encrypted credentials and Keychain storage.

This standalone Node service differs from Desktop’s optional attached browser: the attached browser shares Desktop’s child Web Host and encrypted data, while this command starts a separate Host with session-only credentials. `SSH_CORDIS_NO_WEB_CARRIER=1` disables only Desktop’s attached browser access; it does not affect `start:web`.

Every HTTP resource and WebSocket requires the startup token or a session cookie exchanged for it, and validates the local Host header and browser Origin. The entry point has no public listening option and no user accounts or tenant isolation.

Verification and real-browser checks:

```powershell
npm run build:web
node --test apps/web/tests/*.test.mjs
node apps/web/tests/smoke-browser.mjs
```

The last command uses a test Chromium window to access the standalone Node service. It covers a WebSocket terminal without preload, real SSH authentication with both a directly selected browser key and a Keychain key reference, terminal echo, and credential/key-association clearing after refresh. Electron is used only as the test browser; the Web service itself is an ordinary Node process.
