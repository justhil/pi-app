import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import type { AsrConfig } from '@shared/asr-types'
import { chatGptAccountIdFromAccessToken, isJwtExpired } from '../codex-transcribe/jwt-account-id'

export type CodexAuthProbe = {
  ok: boolean
  authFile: string | null
  authMode?: string
  source?: 'manual' | 'file'
  tokenPreview?: string
  detail?: string
}

function expandAuthCandidates(explicit?: string): string[] {
  const out: string[] = []
  if (explicit?.trim()) out.push(explicit.trim())
  const codexHome = process.env.CODEX_HOME?.trim()
  if (codexHome) out.push(join(codexHome, 'auth.json'))
  out.push(join(homedir(), '.codex', 'auth.json'))
  return [...new Set(out)]
}

export function extractAccessToken(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const tokens = o.tokens
  if (tokens && typeof tokens === 'object') {
    const at = (tokens as Record<string, unknown>).access_token
    if (typeof at === 'string' && at.length > 20) return at
  }
  if (typeof o.access_token === 'string' && o.access_token.length > 20) return o.access_token
  if (typeof o.OPENAI_API_KEY === 'string' && o.OPENAI_API_KEY.startsWith('eyJ')) return o.OPENAI_API_KEY
  return null
}

function maskToken(token: string): string {
  if (token.length <= 12) return '••••'
  return `${token.slice(0, 6)}…${token.slice(-4)}`
}

function manualToken(cfg: Pick<AsrConfig, 'codexAccessToken'>): string | null {
  const t = cfg.codexAccessToken?.trim()
  if (!t || t.length < 20) return null
  return t
}

function authModeFromParsed(parsed: Record<string, unknown>): string | undefined {
  const m = parsed.auth_mode ?? parsed.authMode
  return typeof m === 'string' ? m : undefined
}

function isSupportedChatGptAuthMode(mode: string | undefined): boolean {
  if (!mode) return true
  return mode === 'chatgpt' || mode === 'chatgpt_auth_tokens'
}

function readTokenFromFile(path: string): { token: string | null; authMode?: string; detail?: string } {
  if (!existsSync(path)) return { token: null }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    const authMode = authModeFromParsed(parsed)
    if (!isSupportedChatGptAuthMode(authMode)) {
      return {
        token: null,
        authMode,
        detail: `auth mode is ${authMode}, not ChatGPT token auth`,
      }
    }
    const token = extractAccessToken(parsed)
    if (!token) {
      return {
        token: null,
        authMode,
        detail: 'auth.json found but no access_token',
      }
    }
    return { token, authMode }
  } catch (e: any) {
    return { token: null, detail: e.message || 'failed to read auth.json' }
  }
}

/** 供设置页探测：手动 token 优先于文件 */
export function probeCodexAuth(opts?: { authFile?: string; accessToken?: string }): CodexAuthProbe {
  const manual = opts?.accessToken?.trim()
  if (manual && manual.length >= 20) {
    if (isJwtExpired(manual)) {
      return {
        ok: false,
        authFile: null,
        source: 'manual',
        tokenPreview: maskToken(manual),
        detail: 'access_token JWT expired (refresh from Codex / ChatGPT desktop)',
      }
    }
    const accountId = chatGptAccountIdFromAccessToken(manual)
    return {
      ok: true,
      authFile: null,
      source: 'manual',
      tokenPreview: maskToken(manual),
      detail: accountId ? `token OK · account ${accountId.slice(0, 8)}…` : 'token OK',
    }
  }

  for (const p of expandAuthCandidates(opts?.authFile)) {
    const { token, authMode, detail } = readTokenFromFile(p)
    if (token) {
      return {
        ok: true,
        authFile: p,
        authMode,
        source: 'file',
        tokenPreview: maskToken(token),
      }
    }
    if (existsSync(p) && detail) {
      return { ok: false, authFile: p, authMode, detail }
    }
  }
  return {
    ok: false,
    authFile: null,
    detail: 'No valid access_token — paste a token or sign in with Codex / ChatGPT desktop',
  }
}

/** 从本机 auth.json 读出 access_token（仅用户点击「填入」时调用） */
export function importCodexAccessTokenFromFile(authFile?: string): { ok: boolean; accessToken?: string; detail?: string } {
  for (const p of expandAuthCandidates(authFile)) {
    const { token, detail } = readTokenFromFile(p)
    if (token) return { ok: true, accessToken: token }
    if (existsSync(p) && detail) return { ok: false, detail }
  }
  return { ok: false, detail: 'No ~/.codex/auth.json or missing access_token' }
}

function manualAuthOverlayPath(): string {
  const dir = join(app.getPath('userData'), 'codex-asr')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'manual-auth.json')
}

function writeManualAuthFile(token: string): string {
  const path = manualAuthOverlayPath()
  writeFileSync(
    path,
    JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: token } }, null, 2),
    'utf-8',
  )
  return path
}

/** 启动 codex-asr serve 时使用的 --auth-file（手动配置优先） */
export function resolveAuthFileForServe(cfg: AsrConfig): { ok: boolean; authFile?: string; error?: string } {
  const manual = manualToken(cfg)
  if (manual) {
    try {
      const path = writeManualAuthFile(manual)
      return { ok: true, authFile: path }
    } catch (e: any) {
      return { ok: false, error: e.message || 'failed to write manual auth file' }
    }
  }

  const probe = probeCodexAuth({ authFile: cfg.codexAuthFile })
  if (!probe.ok || !probe.authFile) {
    return { ok: false, error: probe.detail || 'Codex not logged in' }
  }
  return { ok: true, authFile: probe.authFile }
}

/** 直连 ChatGPT /transcribe 用的 bearer（手动 token 优先） */
export function resolveAccessTokenForTranscribe(cfg: AsrConfig): string | null {
  const manual = manualToken(cfg)
  if (manual) return manual
  for (const p of expandAuthCandidates(cfg.codexAuthFile)) {
    const { token } = readTokenFromFile(p)
    if (token) return token
  }
  return null
}