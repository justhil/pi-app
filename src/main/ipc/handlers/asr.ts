import { registerHandler } from '../registry'
import { loadAsrConfig } from '../../asr-config-store'
import { getAsrProvider } from '../../asr/registry'

export function registerAsrHandlers(): void {
  registerHandler('ipc:asr.transcribe', async (req) => {
    const raw = (req?.config && typeof req.config === 'object' ? req.config : null) ?? loadAsrConfig()
    const { normalizeAsrConfigForOps } = await import('../../asr/asr-config-normalize')
    const cfg = normalizeAsrConfigForOps(raw as import('@shared/asr-types').AsrConfig)
    const provider = getAsrProvider(cfg)
    if (!provider) return { ok: false, error: 'not_configured', kind: 'not_configured' }
    const buf = Buffer.from(req.audio, 'base64')
    return provider.transcribe({
      audio: buf,
      mimeType: req.mimeType,
      language: cfg.language || req.language,
    })
  })

  registerHandler('ipc:asr.testConnection', async (req) => {
    const raw = (req?.config && typeof req.config === 'object' ? req.config : null) ?? loadAsrConfig()
    const { normalizeAsrConfigForOps } = await import('../../asr/asr-config-normalize')
    const cfg = normalizeAsrConfigForOps(raw as import('@shared/asr-types').AsrConfig)
    const provider = getAsrProvider(cfg)
    if (!provider) return { ok: false, detail: 'ASR provider not configured (enable built-in voice in Settings)' }
    return provider.testConnection()
  })

  registerHandler('ipc:asr.probeCodexAuth', async (req) => {
    const { probeCodexAuth } = await import('../../asr/codex-auth')
    const cfg = req?.config && typeof req.config === 'object' ? req.config : req
    return probeCodexAuth({
      authFile: cfg?.authFile || cfg?.codexAuthFile ? String(cfg.authFile || cfg.codexAuthFile) : undefined,
      accessToken: cfg?.accessToken || cfg?.codexAccessToken ? String(cfg.accessToken || cfg.codexAccessToken) : undefined,
    })
  })

  registerHandler('ipc:asr.importCodexAccessToken', async (req) => {
    const { importCodexAccessTokenFromFile } = await import('../../asr/codex-auth')
    const authFile = req?.authFile || req?.codexAuthFile ? String(req.authFile || req.codexAuthFile) : undefined
    return importCodexAccessTokenFromFile(authFile)
  })

  registerHandler('ipc:asr.builtinStatus', async () => ({
    running: false,
    directApi: true,
    bundledAvailable: false,
    port: 0,
  }))

  registerHandler('ipc:asr.detectBinary', async () => {
    try {
      const { execSync } = await import('child_process')
      const cmd = process.platform === 'win32' ? 'where codex-asr' : 'which codex-asr'
      const path = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0].trim()
      return { found: !!path, path: path || null }
    } catch {
      return { found: false, path: null }
    }
  })
}