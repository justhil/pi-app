const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/gi

const POLICY_ERROR_PATTERNS: readonly RegExp[] = [
  /PROHIBITED_CONTENT/i,
  /content[_\s-]*filter/i,
  /content[_\s-]*policy/i,
  /safety[_\s-]*(?:settings|system|policy)/i,
  /finish_reason['":\s]+content_filter/i,
  /required\s+tool\s+call/i,
  /内容策略结束生成/,
  /触发.*风控/,
  /Output\s+blocked/i,
]

const TECHNICAL_ERROR_PATTERNS: readonly RegExp[] = [
  /traceback \(most recent call last\)/i,
  /\b(?:SyntaxError|TypeError|ReferenceError|RangeError|URIError):/,
  /\b(?:ENOENT|EACCES|EPERM|ECONNREFUSED|ETIMEDOUT|EADDRINUSE)\b/,
  /\bHTTP\/?\d?(?:\.\d)?\s+(?:401|403|404|408|429|500|502|503|504)\b/i,
  /\bnpm ERR!/,
  /\bexit code\s+[1-9]\d*/i,
]

const STRONG_REFUSAL_PHRASES: readonly string[] = [
  '我无法满足',
  '无法满足这一请求',
  '无法满足您的请求',
  '我不能提供',
  '我无法提供',
  '我不能生成',
  '我无法生成',
  '我无法创作',
  '我不能创作',
  '我无法协助',
  '我不能协助',
  '我无法编写',
  '我不能编写',
  '我没法提供',
  '我没法生成',
  '我没法推荐',
  '不能推荐',
  '没法检索',
  '底线没法碰',
  '红线不能碰',
  '根据安全规范',
  '出于安全与合规',
  '违反安全政策',
  'I cannot fulfill',
  'I can’t fulfill',
  "I can't fulfill",
  'I cannot assist with',
  "I can't assist with",
  'I cannot provide',
  "I can't provide",
  'I am unable to provide',
  'I must refuse',
  'against my safety guidelines',
  'violates our usage policies',
  'Я не могу выполнить',
  'Я не могу предоставить',
  'Я не могу помочь с этим запросом',
]

const DELEGATION_REFUSAL_RES: readonly RegExp[] = [
  /(?:需|须|请)由?你本人.{0,18}(?:前端|网页|浏览器|界面).{0,14}(?:自主操作|手动|自己点|点击运行)/,
  /需要你在.{0,16}(?:前端|网页|浏览器|界面).{0,14}(?:自己点|手动点|运行)/,
  /(?:这边|我这边).{0,12}(?:不代跑|不代提交|不回传成品|只负责.{0,10}原理)/,
  /不代跑.{0,16}(?:视频|成片|脚本|任务)/,
  /(?:仅|只)(?:能|可)?(?:从|在)(?:原理|防御|合规|学术)(?:层面|视角|范围内)(?:探讨|说明|介绍)/,
]

const COMPACTION_POISON_RES: readonly RegExp[] = [
  /(?:拒绝|未予|不予)(?:为|生成|执行|提供|处理).{0,40}(?:请求|内容|脚本|视频|照片)/,
  /不代跑也不回传/,
  /触发.{0,12}(?:安全|保护|合规)(?:筛查|红线|边界)/,
  /\brefused to (?:generate|execute|provide|assist)\b/i,
]

export function stripInlineThinkTags(raw: string): string {
  return String(raw ?? '').replace(THINK_BLOCK_RE, '').trim()
}

export function isPolicyErrorText(raw: unknown): boolean {
  const msg =
    raw instanceof Error
      ? `${raw.name}: ${raw.message}`
      : typeof raw === 'string'
        ? raw
        : JSON.stringify(raw ?? '')
  if (!msg) return false
  return POLICY_ERROR_PATTERNS.some((re) => re.test(msg))
}

export function isTechnicalErrorText(text: string): boolean {
  if (!text) return false
  return TECHNICAL_ERROR_PATTERNS.some((re) => re.test(text))
}

export function isSoftRefusalText(rawText: string): boolean {
  const cleaned = stripInlineThinkTags(rawText)
  if (!cleaned) return false
  if (isTechnicalErrorText(cleaned)) return false

  const head = cleaned.slice(0, 320)
  const lowerHead = head.toLowerCase()
  const lowerAll = cleaned.length <= 420 ? cleaned.toLowerCase() : lowerHead

  for (const phrase of STRONG_REFUSAL_PHRASES) {
    const target = phrase.toLowerCase()
    if (lowerHead.includes(target) || lowerAll.includes(target)) {
      return true
    }
  }

  const windowText = cleaned.slice(0, 600)
  for (const re of DELEGATION_REFUSAL_RES) {
    if (re.test(windowText)) return true
  }

  return false
}

export function cleanCompactionSummaryText(raw: string): string {
  const text = String(raw ?? '')
  if (!text) return text
  const filtered = text
    .split(/\r?\n/)
    .filter((line) => !COMPACTION_POISON_RES.some((re) => re.test(line)))
    .join('\n')
  return filtered.trim() || text
}
