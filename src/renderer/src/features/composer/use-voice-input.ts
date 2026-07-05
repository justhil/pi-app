import { useState, useRef, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { AsrConfig } from '@shared/asr-types'
import { getAsrConfigForComposer, isAsrVoiceReady } from '@renderer/lib/asr-config-effective'

export type VoiceState = 'idle' | 'recording' | 'transcribing' | 'error'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1]
      if (!base64) reject(new Error('empty audio'))
      else resolve(base64)
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

function pickMimeType(): string | null {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return null
}

async function loadEffectiveAsrConfig(): Promise<AsrConfig | null> {
  const res = await ipcClient.invoke('settings.get', {})
  const disk = res?.settings?.asrConfig as AsrConfig | undefined
  return getAsrConfigForComposer(disk ?? null)
}

export function useVoiceInput(
  canCompose: boolean,
  onResult: (text: string) => void,
): {
  voiceState: VoiceState
  toggle: () => void
  disabled: boolean
} {
  const { t: tr } = useTranslation()
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [ready, setReady] = useState(false)
  const effectiveCfgRef = useRef<AsrConfig | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const refreshReady = useCallback(async () => {
    try {
      const cfg = await loadEffectiveAsrConfig()
      effectiveCfgRef.current = cfg
      if (!cfg || !isAsrVoiceReady(cfg)) {
        setReady(false)
        return
      }
      const auth = await ipcClient.invoke('asr.probeCodexAuth', {
        config: {
          codexAuthFile: cfg.codexAuthFile,
          codexAccessToken: cfg.codexAccessToken,
        },
      })
      setReady(!!auth?.ok)
    } catch (e) {
      setReady(false)
    }
  }, [])

  useEffect(() => {
    void refreshReady()
    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshReady()
    }
    const onSaved = () => void refreshReady()
    const onPreview = () => void refreshReady()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pi-desktop:asr-config-saved', onSaved)
    window.addEventListener('pi-desktop:asr-config-preview', onPreview)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pi-desktop:asr-config-saved', onSaved)
      window.removeEventListener('pi-desktop:asr-config-preview', onPreview)
    }
  }, [refreshReady])

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [])

  const start = useCallback(async () => {
    if (!canCompose) return
    await refreshReady()
    const cfg = effectiveCfgRef.current
    if (!cfg || !isAsrVoiceReady(cfg)) {
      toast.error(tr('composer:voice.errorNotConfigured'))
      return
    }
    const auth = await ipcClient.invoke('asr.probeCodexAuth', {
      config: {
        codexAuthFile: cfg.codexAuthFile,
        codexAccessToken: cfg.codexAccessToken,
        codexAccessTokenPreserved: cfg.codexAccessTokenPreserved,
        codexAccessTokenSet: cfg.codexAccessTokenSet,
      },
    })
    if (!auth?.ok) {
      const hasDraftToken =
        !!(cfg.codexAccessToken?.trim() && cfg.codexAccessToken.trim().length >= 20) ||
        !!cfg.codexAccessTokenPreserved
      toast.error(hasDraftToken ? tr('composer:voice.errorAuth') : tr('composer:voice.errorAuthNeedToken'))
      setVoiceState('error')
      return
    }
    const mimeType = pickMimeType()
    if (!mimeType) {
      toast.error(tr('composer:voice.micPermissionDenied'))
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      toast.error(tr('composer:voice.micPermissionDenied'))
      setVoiceState('error')
      return
    }
    streamRef.current = stream
    chunksRef.current = []
    const recorder = new MediaRecorder(stream, { mimeType })
    recorderRef.current = recorder
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mimeType })
      chunksRef.current = []
      if (blob.size === 0) {
        setVoiceState('idle')
        return
      }
      setVoiceState('transcribing')
      try {
        const base64 = await blobToBase64(blob)
        const transcribeCfg = effectiveCfgRef.current ?? (await loadEffectiveAsrConfig())
        const res = await ipcClient.invoke('asr.transcribe', {
          audio: base64,
          mimeType,
          config: transcribeCfg ?? undefined,
        })
        if (res?.ok && res?.text) {
          onResult(res.text)
          setVoiceState('idle')
        } else if (res?.kind === 'auth') {
          const hint = res?.error ? String(res.error).slice(0, 160) : tr('composer:voice.errorAuthExpired')
          toast.error(hint)
          setVoiceState('error')
        } else if (res?.kind === 'network') {
          toast.error(tr('composer:voice.errorNetwork'))
          setVoiceState('error')
        } else if (res?.kind === 'upstream') {
          toast.error(tr('composer:voice.errorUpstream'))
          setVoiceState('error')
        } else if (res?.kind === 'timeout') {
          toast.error(tr('composer:voice.errorTimeout'))
          setVoiceState('error')
        } else if (res?.kind === 'not_configured') {
          toast.error(tr('composer:voice.errorAuthNeedToken'))
          setVoiceState('error')
        } else {
          toast.error(res?.error || tr('composer:voice.errorUnknown'))
          setVoiceState('error')
        }
      } catch (e) {
        toast.error(tr('composer:voice.errorUnknown'))
        setVoiceState('error')
      }
    }
    recorder.start()
    setVoiceState('recording')
  }, [canCompose, onResult, tr, refreshReady])

  const toggle = useCallback(() => {
    if (voiceState === 'recording') stop()
    else if (voiceState === 'idle' || voiceState === 'error') void start()
  }, [voiceState, start, stop])

  useEffect(() => () => stop(), [stop])

  return {
    voiceState,
    toggle,
    disabled: !canCompose || !ready || voiceState === 'transcribing',
  }
}