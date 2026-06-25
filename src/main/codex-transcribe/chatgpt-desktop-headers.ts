import { arch, platform } from 'os'

const DEFAULT_DESKTOP_VERSION = '26.429.30905'
export const CHATGPT_ORIGINATOR = 'Codex Desktop'

function osLabel(): string {
  const p = platform()
  if (p === 'win32') return 'win32'
  if (p === 'darwin') return 'macos'
  if (p === 'linux') return 'linux'
  return p
}

/** 与 codex-asr `CodexAsrClientBuilder::new` 默认 User-Agent 对齐 */
export function chatGptDesktopUserAgent(version = DEFAULT_DESKTOP_VERSION): string {
  return `${CHATGPT_ORIGINATOR}/${version} (${osLabel()}; ${arch()})`
}

export function buildChatGptTranscribeHeaders(
  accessToken: string,
  accountId: string | null | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken.trim()}`,
    originator: CHATGPT_ORIGINATOR,
    'User-Agent': chatGptDesktopUserAgent(),
    Accept: 'application/json',
  }
  if (accountId) {
    headers['ChatGPT-Account-Id'] = accountId
  }
  return headers
}