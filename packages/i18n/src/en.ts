/**
 * The English catalog, and the source of truth for every message key.
 *
 * Keys are `area.subject`, lowercase, hyphenated. A key that varies by count
 * gets an explicit `.one` / `.other` pair rather than a suffix glued on at the
 * call site — English pluralises by changing the noun, Chinese does not, and a
 * sentence is not a concatenation of fragments in either language.
 *
 * Placeholders are `{name}` and are filled by `t()`. A placeholder that is also
 * a sentence (an SFTP action phrase, say) is resolved by the caller and passed
 * in already translated, so word order stays inside the catalog.
 *
 * Error keys are `error.<HostErrorCode>` and are enforced complete by a
 * compile-time assertion in `index.ts`.
 */
export const en = {
  // ── hosts list ────────────────────────────────────────────────────
  'hosts.count.saved.one': '{count} saved',
  'hosts.count.saved.other': '{count} saved',
  'hosts.count.connected.one': '{count} connected',
  'hosts.count.connected.other': '{count} connected',
  'hosts.updated.days-ago.one': '{days} day ago',
  'hosts.updated.days-ago.other': '{days} days ago',

  // ── keychain ──────────────────────────────────────────────────────
  'keychain.usage.one': '{count} host',
  'keychain.usage.other': '{count} hosts',

  // ── sftp action phrases ───────────────────────────────────────────
  //
  // Two shapes on purpose: `sftp.action.*` opens a sentence ("Read directory
  // /var — failed: …") and carries the path; `sftp.action-label.*` is a bare
  // noun phrase for the "does not support X" sentence, which has no path.
  'sftp.action.list': 'Read directory {path}',
  'sftp.action.stat': 'Read the attributes of {path}',
  'sftp.action.read': 'Read {path}',
  'sftp.action.write': 'Write {path}',
  'sftp.action.mkdir': 'Create directory {path}',
  'sftp.action.remove': 'Delete {path}',
  'sftp.action-label.list': 'read directory',
  'sftp.action-label.stat': 'read attributes',
  'sftp.action-label.read': 'read file',
  'sftp.action-label.write': 'write file',
  'sftp.action-label.mkdir': 'create directory',
  'sftp.action-label.remove': 'delete',

  // ── ssh ───────────────────────────────────────────────────────────
  'error.ssh.empty-host': 'Enter a host address.',
  'error.ssh.empty-username': 'Enter a username.',
  'error.ssh.missing-credential': 'No credential to authenticate with: enter a password, choose a private key file, or let ssh-agent load a key first.',
  'error.ssh.client-disconnected': 'The client disconnected.',
  'error.ssh.auth-failed': 'Authentication failed: the username, password, or key is wrong.',
  'error.ssh.key-passphrase-needed': 'This key is passphrase-protected — fill in the key passphrase.',
  'error.ssh.key-unrecognized': 'That file is not a recognizable private key (OpenSSH and PEM are supported); choose another.',
  'error.ssh.key-unparseable': 'The private key could not be parsed: the passphrase may be wrong, or this is not an OpenSSH/PEM key.',
  'error.ssh.key-file-unreadable': 'Cannot read the private key file: {path} ({reason}).',
  'error.ssh.banner-before-handshake': 'The TCP connection to {host}:{port} was established, but the peer disconnected before sending an SSH banner. Authentication was never reached, so this is not a key or password problem. Common causes: the port is not running SSH; a security group or firewall lets TCP through but drops the data; or the peer is briefly unstable (retrying after a few seconds usually works).',
  'error.ssh.exec-channel-refused': 'Connected and authenticated to {host}:{port}, but the server refused the command channel. Common causes: the account is restricted by ForceCommand (interactive shell only), or it has hit its concurrent channel limit (OpenSSH MaxSessions, default 10). The terminal itself still works.',
  'error.ssh.sftp-subsystem-unavailable': 'Connected and authenticated to {host}:{port}, but the server could not start the SFTP subsystem. Common causes: Subsystem sftp is commented out in sshd_config (on by default in OpenSSH; many minimal images turn it off), or the account is restricted by ForceCommand/ChrootDirectory. The terminal itself still works.',
  'error.ssh.channel-refused': 'Connected and authenticated to {host}:{port}, but the server could not open this channel. Common cause: the account has hit its concurrent channel limit (OpenSSH MaxSessions, default 10).',
  'error.ssh.connection-refused': 'Cannot connect to {host}:{port}: the port refused the connection (no service listening, or blocked by a firewall).',
  'error.ssh.dns-failed': 'Cannot resolve the host name {host}.',
  'error.ssh.timeout': 'Connecting to {host}:{port} timed out: the network is unreachable, or the port is dropping packets.',
  'error.ssh.host-key-changed': 'The host key changed, which could be a man-in-the-middle attack.\n  Recorded: {known}\n  Received: {actual}\nIf you are sure this is expected, delete this host from {file} and connect again.',
  'error.ssh.host-key-verification-failed': 'Host key verification failed: the key for {host}:{port} does not match the local record.',
  'error.ssh.first-connection': 'First connection to this host; its fingerprint is {fingerprint} (the current policy requires explicit confirmation).',
  'error.ssh.connection-reset': 'The connection to {host}:{port} was reset.',
  'error.ssh.handshake-closed': 'The SSH connection closed before the handshake completed.',
  'error.ssh.connection-error': 'Connection error: {detail}',
  'error.ssh.connection-closed': 'The connection closed',
  'error.ssh.server-disconnected': 'The server closed the connection',
  'error.ssh.session-closed': 'The session closed',
  'error.ssh.session-gone': 'That session does not exist or is already closed; connect again.',
  'error.ssh.exec-cancelled': 'Command execution was cancelled.',
  'error.ssh.exec-output-limit': 'Command output exceeded the {maxBytes}-byte limit.',
  'error.ssh.exec-timeout': 'Command execution timed out ({timeout}ms).',
  'error.ssh.exec-session-closed': 'The session closed, so the command was cancelled.',
  'error.ssh.failed': 'Connection to {host}:{port} failed: {detail}',

  // ── sftp ──────────────────────────────────────────────────────────
  'error.sftp.bad-name': 'Invalid name: “{leaf}”. Enter a single name — no slashes, and not . or ..',
  'error.sftp.no-such-file': 'No such file at {path} on the remote — it may have been moved or deleted; press Refresh.',
  'error.sftp.no-such-directory': 'The remote directory does not exist: {path} is not a directory you can enter. Uploads and new folders can only land in a directory that already exists — create it in the terminal first, or pick another location.',
  'error.sftp.permission-denied': '{describe} failed: the remote account has no permission for that location (wrong owner, or the directory is not writable).',
  'error.sftp.permission-denied-plain': '{describe} failed: the remote account has no permission for that location.',
  'error.sftp.op-unsupported': 'The remote SFTP service does not support “{label}”.',
  'error.sftp.remove-failed': '{describe} failed: the directory may not be empty, or another process is using it. Only empty directories can be deleted.',
  'error.sftp.mkdir-failed': '{describe} failed: that name may already exist (a file or directory with the same name).',
  'error.sftp.write-failed': '{describe} failed: the remote may be out of space, or the directory is not writable.',
  'error.sftp.failed-rejected': '{describe} failed: the remote rejected the operation ({detail}).',
  'error.sftp.is-directory': '{path} is a directory and cannot be downloaded as a file.',
  'error.sftp.download-too-large': '{path} is {size} bytes, over the {limit}-byte single-transfer limit. The whole file has to cross as base64 + JSON (the Web carrier caps one message at 8 MiB) and chunked streaming is not built yet. Use scp or rsync in the terminal for this file.',
  'error.sftp.upload-too-large': 'The content to upload is {size} bytes, over the {limit}-byte single-transfer limit. Chunked streaming is not built yet — pick a smaller file.',
  'error.sftp.no-such-path': 'Invalid path: {path} is a directory itself, so there is nothing to delete.',
  'error.sftp.failed': '{describe} failed: {detail}',

  // ── keychain ──────────────────────────────────────────────────────
  'error.keychain.desktop-store-in-web': 'This directory holds a Desktop keychain. Use a separate data directory for the Web.',
  'error.keychain.invalid-store': 'The keychain format is invalid; the original file was not overwritten.',
  'error.keychain.invalid-record': 'Invalid keychain record.',
  'error.keychain.decrypt-failed': 'Cannot decrypt the keychain. Check the system encryption service.',
  'error.keychain.material-undecryptable': 'Cannot decrypt the saved private key. Check the system encryption service, or import it again.',
  'error.keychain.entry-missing': 'The selected key does not exist or has left this session; import it again in the Keychain.',
  'error.keychain.label-required': 'Enter a key name (at most 200 characters).',
  'error.keychain.id-invalid': 'Invalid key ID.',
  'error.keychain.field-not-text': 'Key fields must be text.',
  'error.keychain.passphrase-too-long': 'The key passphrase is too long.',
  'error.keychain.content-too-large': 'The key content exceeds 256 KiB.',
  'error.keychain.not-found': 'That key does not exist; refresh the list.',
  'error.keychain.limit-reached': 'The keychain holds at most 500 keys.',
  'error.keychain.material-required': 'Paste a private key or import a key file.',
  'error.keychain.private-key-too-large': 'The private key exceeds 256 KiB.',
  'error.keychain.parse-failed': 'Cannot parse the private key: check the format; an encrypted key needs the correct passphrase.',
  'error.keychain.public-only': 'A private key is required; a public key alone cannot be imported.',
  'error.keychain.public-mismatch': 'The public key does not match the private key. Leave it empty to have one generated.',
  'error.keychain.encryption-unavailable': 'System encryption is unavailable, so the key was not saved. Plain-text storage will not be used.',

  // ── host facade, terminal bridge, session store ───────────────────
  'error.host.closed': 'The Host is shut down and cannot open a new connection.',
  'error.host.closed-mutation': 'The Host is shut down and cannot modify records.',
  'error.host.closed-monitor': 'The Host is shut down and cannot start monitoring.',
  'error.host.shutdown': 'The Host is shut down.',
  'error.host.client-closed': 'The client closed, so the operation was cancelled.',
  'error.host.client-gone': 'The client disconnected, or the Host shut down.',
  'error.host.client-disconnected': 'The client disconnected.',
  'error.host.renderer-gone': 'The renderer is unavailable.',
  'error.host.renderer-closed': 'The renderer closed.',
  'error.host.password-undecryptable': 'The saved password cannot be decrypted (the system key may have changed). Enter the password again.',
  'error.host.key-required': 'Choose a key or a private key file.',
  'error.host.key-id-invalid': 'Invalid key ID.',
  'error.host.key-missing': 'The selected key does not exist; choose again.',
  'error.host.key-in-use': 'This key is in use by a host. Change that host’s authentication or delete the host first.',
  'error.host.session-not-owned': 'That session does not exist, or does not belong to this client.',
  'error.host.subscription-in-use': 'That subscription ID is already used on another session.',
  'error.host.shell-closed': 'The remote shell closed.',
  'error.host.channel-error': 'Channel error: {detail}',
  'error.host.write-failed': 'Write failed: {detail}',
  'error.host.resize-failed': 'Resize failed: {detail}',
  'error.host.session-closed': 'The session closed.',
  'error.host.user-disconnected': 'Disconnected by the user.',
  'error.host.monitor-unavailable': 'Resource monitoring is unavailable in this environment.',
  'error.host.store-has-credentials': 'This data directory holds saved credentials. Use a separate data directory for the local Web.',
  'error.host.store-has-legacy-credentials': 'This data directory holds credentials encrypted by an older version. Read it with the Desktop, and choose a separate data directory for the local Web.',

  // ── monitor ───────────────────────────────────────────────────────
  'error.monitor.probe-signalled': 'The remote probe command was terminated by signal {signal}.',
  'error.monitor.probe-exit-code': 'The remote probe command exited with code {code}.',
  'error.monitor.unsupported-os': 'This host runs {os}, which resource monitoring does not support yet.',
  'error.monitor.no-metrics': 'The remote returned no usable metrics.',
  'error.monitor.probe-failed': 'The monitor probe failed.',
  // The nine frame faults are flat rather than one wrapper plus a sub-reason:
  // the wrapper's only content was the sub-reason, so folding them together
  // keeps `params` a flat map and reads better in both languages.
  'error.monitor.frame.no-header': 'The monitor output was not a recognizable data frame: no start marker was found.',
  'error.monitor.frame.duplicate': 'The monitor output was not a recognizable data frame: the frame appeared twice.',
  'error.monitor.frame.expected-section': 'The monitor output was not a recognizable data frame: expected the {name} section, read “{actual}”.',
  'error.monitor.frame.missing-status': 'The monitor output was not a recognizable data frame: the {name} section has no closing status line.',
  'error.monitor.frame.status-range': 'The monitor output was not a recognizable data frame: the {name} section’s exit status is out of range.',
  'error.monitor.frame.os-unavailable': 'The monitor output was not a recognizable data frame: the OS section is unusable.',
  'error.monitor.frame.no-end-marker': 'The monitor output was not a recognizable data frame: no end marker was found.',
  'error.monitor.frame.trailing-content': 'The monitor output was not a recognizable data frame: there is content after the end marker.',
  'error.monitor.frame.missing-os': 'The monitor output was not a recognizable data frame: the OS section is missing.',

  // ── carrier and dispatcher validation ─────────────────────────────
  'error.transport.params-not-array': 'Parameters must be an array.',
  'error.dispatch.arg-not-object': '{where} expects an object as its first argument.',
  'error.dispatch.arg-not-string': '{where} expects a string argument, received {got}.',
  'error.dispatch.arg-not-number': '{where} expects a number argument, received {got}.',
  'error.dispatch.arg-not-bytes': '{where} expects bytes (Uint8Array), received {got}.',
  'error.dispatch.extra-field': '{where} does not accept the field “{key}”.',
  'error.dispatch.bad-session-id': 'The session ID for {where} is invalid.',
  'error.dispatch.bad-subscription-id': 'The subscription ID for {where} is invalid.',
  'error.dispatch.unknown-request': 'Unknown request: {method}',
  'error.dispatch.unknown-notice': 'Unknown notice: {name}',

  // ── fallback ──────────────────────────────────────────────────────
  'error.internal': 'An internal error occurred.',
} as const

export type MessageKey = keyof typeof en
