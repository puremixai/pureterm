import { hasKey, t } from '@pureterm/i18n'

/**
 * Apply the active locale to the static markup.
 *
 * `index.html` ships English, because English is the catalog's source language
 * and the default. A user on another locale therefore sees one English frame
 * before this runs — accepted deliberately, since the alternative is an inline
 * script and the CSP forbids one.
 *
 * Three attributes, and the split is not arbitrary:
 *
 * - `data-i18n` replaces `textContent`. The element must hold the text and
 *   nothing else, so a button with an icon puts its label in a `<span>`.
 * - `data-i18n-attr` replaces attributes, written `name:key` and separated by
 *   `;`. One element often needs two (`aria-label` and `title` say the same
 *   thing to different audiences).
 * - `data-i18n-html` replaces `innerHTML`, for the one string that has to keep
 *   inline markup (`<kbd>` in the shortcut note). It is not a general escape
 *   hatch: the value comes from the catalog, never from input.
 *
 * A key the catalog does not know is skipped rather than blanked, so a typo
 * leaves the English in place instead of emptying the element.
 */
export function translateDocument(root: ParentNode): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset.i18n
    if (key && hasKey(key)) node.textContent = t(key)
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-html]')) {
    const key = node.dataset.i18nHtml
    if (key && hasKey(key)) node.innerHTML = t(key)
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
    for (const pair of (node.dataset.i18nAttr ?? '').split(';')) {
      const separator = pair.indexOf(':')
      if (separator < 1) continue
      const attribute = pair.slice(0, separator).trim()
      const key = pair.slice(separator + 1).trim()
      if (attribute && hasKey(key)) node.setAttribute(attribute, t(key))
    }
  }
}
