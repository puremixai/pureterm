import type { HostErrorCode, WireError } from '@pureterm/protocol'
import { en, type MessageKey } from './en.js'
import { zh } from './zh.js'

export type { MessageKey }

export type Locale = 'en' | 'zh'
export type MessageParams = Readonly<Record<string, string | number>>

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { en, zh }

/**
 * The active locale, as a module singleton.
 *
 * A singleton rather than a threaded parameter keeps `t(key, params)` callable
 * from anywhere without every module carrying a locale it does not own. The
 * process that decides is the one that owns the preference (the browser's
 * chrome service, the Electron main process, the Web CLI), and it calls
 * `setLocale` before anything paints.
 */
let current: Locale = 'en'

export function setLocale(locale: Locale): void {
  current = locale
}

export function getLocale(): Locale {
  return current
}

/** Narrow an arbitrary value — a stored preference, a CLI flag — to a Locale. */
export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh'
}

/**
 * Pick a locale from a BCP-47 tag, falling back to English.
 *
 * Only the two catalogs exist, so this is a membership test on the primary
 * subtag rather than a negotiation: `zh-Hans-CN` is Chinese, everything else
 * is English until there is a third catalog to choose between.
 */
export function localeFromTag(tag: string | undefined | null): Locale {
  return typeof tag === 'string' && /^zh\b/i.test(tag.trim()) ? 'zh' : 'en'
}

/** Does the catalog know this key? Used before rendering a code we were handed. */
export function hasKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key)
}

/**
 * Render a message, filling `{name}` placeholders from `params`.
 *
 * A placeholder with no matching param is left standing rather than blanked:
 * `{path}` in the output says exactly what is missing, where an empty string
 * would look like a rendering bug in the sentence itself.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  const template = CATALOGS[current][key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    return value === undefined ? whole : String(value)
  })
}

// `K extends …` with K a naked parameter distributes over the union, which is
// what turns the whole key union into the set of plural bases.
type StripOne<K> = K extends `${infer Base}.one` ? Base : never

/** Every key that has a `.one` / `.other` pair. `tPlural` only accepts these. */
export type PluralBase = StripOne<MessageKey>

/**
 * Render a count-sensitive message from its `.one` / `.other` pair.
 *
 * English changes the noun and Chinese does not, so the pair is explicit in
 * both catalogs rather than a suffix appended here — this function only picks
 * a side, and `count` is passed to the sentence so it can place the number.
 */
export function tPlural(base: PluralBase, count: number, params?: MessageParams): string {
  const suffix = count === 1 ? 'one' : 'other'
  return t(`${base}.${suffix}` as MessageKey, { count, ...params })
}

/**
 * Render a wire error.
 *
 * A code the catalog knows becomes a sentence in the active locale. A code it
 * does not — a newer Host talking to an older renderer — falls back to the
 * diagnostic `message`, which is never localized but is always present, so the
 * failure screen has something to show instead of a blank.
 */
export function tWireError(error: WireError): string {
  const key = `error.${error.code}`
  return hasKey(key) ? t(key, error.params) : error.message
}

type ErrorKey = `error.${HostErrorCode}`

/*
 * Compile-time assertion, read by nothing at runtime: `en` is the source of
 * every key, and `zh` is typed against it, so between them these two
 * assignments prove that each declared Host error code has a sentence in both
 * languages. Add a code to HOST_ERROR_CODES without a message and this stops
 * compiling — which is the only way a new error can reach a user untranslated.
 */
const errorCatalogComplete: readonly [Record<ErrorKey, string>, Record<ErrorKey, string>] = [en, zh]
void errorCatalogComplete
