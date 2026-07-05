export type AsrErrorKind = 'not_configured' | 'auth' | 'network' | 'upstream' | 'timeout' | 'unknown'

export interface AsrTranscribeRequest {
  audio: Buffer
  mimeType: string
  language?: 'auto' | 'zh' | 'en'
  filename?: string
}

export type AsrTranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string; kind: AsrErrorKind }

export interface AsrProvider {
  id: string
  transcribe(req: AsrTranscribeRequest): Promise<AsrTranscribeResult>
  testConnection(): Promise<{ ok: boolean; detail?: string }>
}

export interface AsrConfig {
  /** builtin = 应用内直连 ChatGPT transcribe；cli/serve 为高级/兼容 */
  provider: 'codex-asr-builtin' | 'codex-asr-cli' | 'codex-asr-serve' | 'none'
  cliBinaryPath?: string
  serverUrl?: string
  /** 本地 serve 的 API key（builtin 默认 --no-api-key，此项可留空） */
  apiKey?: string
  /** 覆盖 Codex 登录文件路径，默认 ~/.codex/auth.json */
  codexAuthFile?: string
  /** ChatGPT/Codex JWT（tokens.access_token）；填写后优先于 auth.json */
  codexAccessToken?: string
  /** settings.get：密钥在 safeStorage，不回传明文 */
  codexAccessTokenSet?: boolean
  codexAccessTokenPreview?: string
  /** settings.set：未改 token 时保留 safeStorage 中的密钥 */
  codexAccessTokenPreserved?: boolean
  builtinServePort?: number
  language?: 'auto' | 'zh' | 'en'
  timeoutMs?: number
}
