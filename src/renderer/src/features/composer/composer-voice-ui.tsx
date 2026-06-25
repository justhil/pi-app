import { Mic, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import type { VoiceState } from './use-voice-input'

type ComposerVoiceMicButtonProps = {
  voiceState: VoiceState
  disabled: boolean
  onClick: () => void
}

/** 工具栏发送位：空闲麦 / 录音涟漪 / 转写细条（对齐 ChatGPT 网页 dictation 克制态） */
export function ComposerVoiceMicButton({ voiceState, disabled, onClick }: ComposerVoiceMicButtonProps) {
  const { t } = useTranslation()
  const recording = voiceState === 'recording'
  const transcribing = voiceState === 'transcribing'

  if (transcribing) {
    return (
      <div
        className="composer-voice-eq flex h-8 w-8 items-center justify-center rounded-md bg-muted/50"
        role="status"
        aria-label={t('composer:voice.transcribing')}
      >
        <div className="composer-voice-eq-bars flex h-3.5 items-end gap-[2px]" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="composer-voice-eq-bar" style={{ animationDelay: `${i * 0.11}s` }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('composer-voice-mic-wrap relative flex h-8 w-8 items-center justify-center', recording && 'is-recording')}>
      {recording && (
        <>
          <span className="composer-voice-ripple" aria-hidden />
          <span className="composer-voice-ripple composer-voice-ripple--delay" aria-hidden />
        </>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={
          disabled
            ? t('composer:voice.notConfigured')
            : recording
              ? t('composer:voice.stop')
              : t('composer:voice.start')
        }
        aria-pressed={recording}
        className={cn(
          'composer-toolbar-send composer-voice-mic-btn relative z-[1] flex h-8 w-8 items-center justify-center rounded-md transition-[background-color,box-shadow,transform] duration-[var(--motion-fast)] ease-[var(--motion-ease)]',
          recording
            ? 'bg-foreground text-background shadow-sm'
            : 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-25',
        )}
      >
        {recording ? (
          <Square className="h-2.5 w-2.5 fill-current" strokeWidth={0} />
        ) : (
          <Mic className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </button>
    </div>
  )
}

type ComposerVoiceInputOverlayProps = {
  voiceState: VoiceState
  active: boolean
}

/** 输入区中央轻波形（录音）/ 转写 shimmer（仅空输入主麦态） */
export function ComposerVoiceInputOverlay({ voiceState, active }: ComposerVoiceInputOverlayProps) {
  const { t } = useTranslation()
  if (!active) return null

  if (voiceState === 'recording') {
    return (
      <div className="composer-voice-overlay composer-voice-overlay--rec pointer-events-none absolute inset-x-2 top-2 bottom-10 flex items-center justify-center gap-3" aria-hidden>
        <div className="composer-voice-live-bars flex h-5 items-end gap-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <span key={i} className="composer-voice-live-bar" style={{ animationDelay: `${i * 0.08}s` }} />
          ))}
        </div>
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground/80">
          {t('composer:voice.listening')}
        </span>
      </div>
    )
  }

  if (voiceState === 'transcribing') {
    return (
      <div
        className="composer-voice-overlay composer-voice-overlay--tx pointer-events-none absolute inset-x-2 top-2 bottom-10 flex items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <span className="composer-voice-shimmer text-[13px] text-muted-foreground">{t('composer:voice.transcribing')}</span>
      </div>
    )
  }

  return null
}