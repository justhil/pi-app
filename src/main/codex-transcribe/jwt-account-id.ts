/** 从 ChatGPT access_token JWT 解析 ChatGPT-Account-Id（与 codex-asr account_id_from_access_token 对齐） */

function decodeJwtPayloadSegment(segment: string): Record<string, unknown> | null {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  try {
    const json = Buffer.from(normalized + pad, 'base64').toString('utf-8')
    const data = JSON.parse(json) as Record<string, unknown>
    return data && typeof data === 'object' ? data : null
  } catch (e) {
    return null
  }
}

export function chatGptAccountIdFromAccessToken(token: string): string | null {
  const parts = token.trim().split('.')
  if (parts.length < 2) return null
  const data = decodeJwtPayloadSegment(parts[1])
  if (!data) return null
  const auth = data['https://api.openai.com/auth'] as Record<string, unknown> | undefined
  const id = auth?.chatgpt_account_id
  if (typeof id === 'string' && id.length > 0) return id
  if (typeof data.chatgpt_account_id === 'string' && data.chatgpt_account_id.length > 0) {
    return data.chatgpt_account_id
  }
  return null
}

export function jwtExpiryFromAccessToken(token: string): number | null {
  const parts = token.trim().split('.')
  if (parts.length < 2) return null
  const data = decodeJwtPayloadSegment(parts[1])
  const exp = data?.exp
  return typeof exp === 'number' && Number.isFinite(exp) ? exp : null
}

export function isJwtExpired(token: string, skewSec = 60): boolean {
  const exp = jwtExpiryFromAccessToken(token)
  if (exp == null) return false
  return Date.now() / 1000 >= exp - skewSec
}