import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import { readSessionIdFromFile } from './session-file-meta'

/**
 * 自动命名：从会话首条用户消息用规则提取标题（不调用模型）。
 * 规则：剥离行首 `/` 命令调用行 → 剔除 URL 与文件路径（不适宜作标题）→ 折叠空白 → 按字符截断 40 字。
 * 结果写入 JSONL `session_info` 由调用方（rename 通道）负责。
 */

const MAX_LINES = 4000
const MAX_TITLE_CHARS = 40

const URL_RE = /https?:\/\/[^\s]*/gi
// 文件路径：Windows 盘符路径（C:\…、C:/…）、Unix 绝对/家目录/相对路径（/x、~/x、./x、../x）。
// `\/[^\s]+` 要求斜杠后紧跟非空白字符，避免误伤行中的 “/ shift” 这类普通斜杠。
const FILE_PATH_RE = /(?:[A-Za-z]:[\\/]|(?:\/|~\/|\.{1,2}[\\/]))[^\s]+/gi

type SessionEntry = {
  type?: string
  message?: { role?: string; content?: unknown }
}

function messageTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(
        (p): p is { type?: string; text?: unknown } =>
          !!p && typeof p === 'object' && (p as { type?: string }).type === 'text',
      )
      .map((p) => String(p.text ?? ''))
      .join('')
  }
  return ''
}

/** 有界扫描 JSONL 头部，取首条 user 消息文本（避免整文件加载）。 */
export async function readFirstUserMessageText(sessionFile: string): Promise<string> {
  const rl = createInterface({
    input: createReadStream(sessionFile, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  let lines = 0
  try {
    for await (const line of rl) {
      if (++lines > MAX_LINES) break
      if (!line.trim()) continue
      let entry: SessionEntry
      try {
        entry = JSON.parse(line) as SessionEntry
      } catch {
        continue // 半行（CLI 写入中）跳过
      }
      if (entry.type !== 'message') continue
      const msg = entry.message
      if (!msg || msg.role !== 'user') continue
      const text = messageTextContent(msg.content).trim()
      if (text) return text
    }
  } finally {
    rl.close()
  }
  return ''
}

/**
 * 清洗规则：
 * - 剥离「行首以 / 开头」的命令调用行（含前导空行），直到出现非命令文本；行中斜杠不动
 * - 剔除 URL（http/https）与文件路径（Windows 盘符、Unix 绝对/家目录/相对路径）——不适宜作标题
 * - 剔除后为空的整行丢弃；折叠换行/连续空白为单空格
 */
export function cleanAutoNameText(raw: string): string {
  const lines = raw.split(/\r?\n/)
  const meaningful: string[] = []
  let sawContent = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!sawContent) {
      if (!trimmed) continue // 前导空行
      if (/^\/\S/.test(trimmed)) continue // 行首 / 命令（/x 形式，非 "/ shift"）
      sawContent = true
    }
    const cleaned = trimmed.replace(URL_RE, ' ').replace(FILE_PATH_RE, ' ').replace(/\s+/g, ' ').trim()
    if (cleaned) meaningful.push(cleaned)
  }
  return meaningful.join(' ').trim()
}

function truncateChars(s: string, max: number): string {
  if ([...s].length <= max) return s
  return [...s].slice(0, max).join('').replace(/[，。、；：,.…\s]+$/, '') + '…'
}

export async function autoNameTitle(sessionFile: string): Promise<string> {
  const raw = await readFirstUserMessageText(sessionFile)
  const cleaned = cleanAutoNameText(raw)
  if (cleaned) return truncateChars(cleaned, MAX_TITLE_CHARS)
  const id = readSessionIdFromFile(sessionFile)
  return id ? id.slice(0, 8) : ''
}
