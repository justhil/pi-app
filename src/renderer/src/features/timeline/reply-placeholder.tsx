import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { ThinkingChainBlock } from './thinking-chain-block'

/**
 * 3×3 pixel wave — the pixel-π loading motif shrunk to the 12px activity slot. Cells light up
 * along the diagonal; only opacity/transform animate, so the loop stays on the compositor.
 */
export function PixelWave({ className }: { className?: string }) {
  return (
    <span className={className ? `pixel-wave ${className}` : 'pixel-wave'} aria-hidden>
      {Array.from({ length: 9 }, (_, cell) => (
        <i key={cell} style={{ '--d': Math.floor(cell / 3) + (cell % 3) } as CSSProperties} />
      ))}
    </span>
  )
}

/**
 * Optimistic reply slot shown the moment a message is sent, until the first token / tool / run
 * event. A first message can wait several seconds on session + worker creation before the model
 * even starts, so the label names the real stage and the wait time instead of a generic
 * "thinking", and two skeleton lines hold the space the reply will take.
 */
export function ReplyPlaceholder({ startedAt, labelSeed }: { startedAt?: number; labelSeed: string }) {
  const { t } = useTranslation()
  const stage = useUIStore((state) => (state.agentTurnBootstrapping ? state.pendingTurnStage : null))
  const liveLabel =
    stage === 'starting'
      ? t('timeline:pendingStage.starting')
      : stage === 'sending'
        ? t('timeline:pendingStage.sending')
        : undefined
  return (
    <div className="reply-placeholder" data-stage={stage ?? 'thinking'} role="status" aria-live="polite">
      <ThinkingChainBlock
        text=""
        streaming
        placeholder
        startedAt={startedAt}
        labelSeed={labelSeed}
        liveLabel={liveLabel}
        showElapsed
        leadingGlyph={<PixelWave />}
      />
      <div className="reply-placeholder-skeleton" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  )
}
