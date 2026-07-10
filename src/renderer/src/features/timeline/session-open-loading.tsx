import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  buildPixelPiCells,
  PIXEL_PI_COLS,
  PIXEL_PI_ROW_COUNT,
} from './pixel-pi-matrix'

const PIXEL_CELLS = buildPixelPiCells()

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

function readSessionPixelShadowTokens(): {
  rest: string
} {
  const styles = getComputedStyle(document.documentElement)
  return {
    rest: styles.getPropertyValue('--session-pixel-shadow').trim() || '0 2px 6px rgba(0,0,0,0.08)',
  }
}

/**
 * Cold open / first session: finite pixel assembly + one parent opacity pulse.
 * Avoids per-pixel infinite WAAPI/CSS animations (idle GPU cost when loading sticks).
 */
export function SessionOpenLoadingView() {
  const { t } = useTranslation()
  const logoRef = useRef<HTMLDivElement>(null)
  const captionRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const root = logoRef.current
    if (!root) return
    const pixels = root.querySelectorAll<HTMLElement>('.session-pixel--on')
    const animations: Animation[] = []
    const shadows = readSessionPixelShadowTokens()

    const assembleKeyframes: Keyframe[] = [
      { opacity: 0, transform: 'scale(0.7)', boxShadow: 'none' },
      { opacity: 1, transform: 'scale(1.04)', offset: 0.75 },
      {
        opacity: 1,
        transform: 'scale(1)',
        boxShadow: shadows.rest,
      },
    ]

    pixels.forEach((element, pixelIndex) => {
      const delayMs = pixelIndex * 26
      animations.push(
        element.animate(assembleKeyframes, {
          duration: 380,
          easing: EASE,
          fill: 'forwards',
          delay: delayMs,
        }),
      )
    })

    // Single parent-level compositor pulse instead of N infinite pixel animations.
    animations.push(
      root.animate(
        [
          { opacity: 0.88, transform: 'scale(1)' },
          { opacity: 1, transform: 'scale(1.01)' },
          { opacity: 0.88, transform: 'scale(1)' },
        ],
        {
          duration: 2400,
          easing: EASE,
          iterations: Infinity,
          delay: 900,
        },
      ),
    )

    if (captionRef.current) {
      animations.push(
        captionRef.current.animate(
          [
            { opacity: 0, transform: 'translateY(4px)' },
            { opacity: 0.75, transform: 'translateY(0)' },
          ],
          { duration: 480, easing: EASE, fill: 'forwards', delay: 400 },
        ),
      )
    }

    return () => animations.forEach((animation) => animation.cancel())
  }, [])

  return (
    <div
      className="session-pixel-loading flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-8"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="chat-content-column flex w-full flex-col items-center gap-[22px]">
        <div
          ref={logoRef}
          className="session-pixel-logo"
          style={
            {
              display: 'grid',
              gap: 'var(--session-pixel-gap)',
              gridTemplateColumns: `repeat(${PIXEL_PI_COLS}, var(--session-pixel-size))`,
              gridTemplateRows: `repeat(${PIXEL_PI_ROW_COUNT}, var(--session-pixel-size))`,
              justifyContent: 'center',
              padding: '20px 24px',
              borderRadius: '16px',
              background: 'var(--session-pixel-surface)',
              boxShadow: 'var(--session-pixel-card-shadow)',
            } as React.CSSProperties
          }
          aria-hidden="true"
        >
          {PIXEL_CELLS.map((cell) => (
            <span
              key={cell.key}
              className={cell.on ? 'session-pixel session-pixel--on' : 'session-pixel session-pixel--off'}
              style={{
                width: 'var(--session-pixel-size)',
                height: 'var(--session-pixel-size)',
                borderRadius: 'var(--session-pixel-radius)',
                background: cell.on ? 'var(--session-pixel-ink)' : 'transparent',
                opacity: cell.on ? 0 : 1,
                visibility: cell.on ? 'visible' : 'hidden',
                pointerEvents: 'none',
              }}
            />
          ))}
        </div>
        <p
          ref={captionRef}
          className="session-pixel-caption text-[13px] text-foreground-secondary"
          style={{ opacity: 0 }}
        >
          {t('timeline:loadingSession')}
        </p>
      </div>
    </div>
  )
}
