import { t, type MessageKey, type MessageParams } from '@pureterm/i18n'

/**
 * 一句要画出来的话，两种来源。
 *
 * `{ key }` 是目录里的一句话：**画的时候才解析**，所以换语言之后重画一次就会
 * 跟着变。`{ text }` 是已经成型的一句话 —— 宿主或载体报上来的原文，它说的是
 * 哪门语言由说它的那一端决定，页面只能原样转述。
 *
 * 为什么要这个类型而不是到处存 `string`：标签页状态、文件面板提示、资源面板的
 * 错误行都是**先算好、之后再画**的。存字符串的话，用户在连接失败之后切一次语言，
 * 那几行会留在上一门语言里 —— 而它们恰好是用户最需要读懂的那几行。
 */
export type MessageText = { key: MessageKey; params?: MessageParams } | { text: string }

export function messageKey(key: MessageKey, params?: MessageParams): MessageText {
  return { key, params }
}

export function messageText(text: string): MessageText {
  return { text }
}

/** 目录里的一句话就翻译，别处来的原样返回。没有内容时是空串，不是 'undefined'。 */
export function resolveMessage(message: MessageText | null | undefined): string {
  if (!message) return ''
  return 'key' in message ? t(message.key, message.params) : message.text
}
