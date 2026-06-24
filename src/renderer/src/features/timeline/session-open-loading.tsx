import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  buildPixelPiCells,
  PIXEL_PI_COLS,
  PIXEL_PI_ROW_COUNT,
} from './pixel-pi-matrix'

const PIXEL_CELLS = buildPixelPiCells()
const ON_CELLS = PIXEL_CELLS.filter((c) => c.on)

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

const IN_KEYFRAMES = [
  { opacity: 0, transform: 'scale(0.7)', boxShadow: 'none' },
  { opacity: 1, transform: 'scale(1.04)', offset: 0.75 },
  { opacity: 1, transform: 'scale(1)', boxShadow: '0 2px 6px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)' },
]

const BREATHE_KEYFRAMES = [
  { opacity: 0.28, transform: 'scale(0.96)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' },
  { opacity: 1, transform: 'scale(1)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' },
  { opacity: 0.28, transform: 'scale(0.96)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' },
]

/** 冷启动 / 首点会话：Web Animations API 驱动像素 PI（不依赖 CSS 加载） */
export function SessionOpenLoadingView() {
  const { t } = useTranslation()
  const logoRef = useRef<HTMLDivElement>(null)
  const captionRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const root = logoRef.current
    if (!root) return
    const pixels = root.querySelectorAll<HTMLElement>('.session-pixel--on')
    const animations: Animation[] = []

    pixels.forEach((el, i) => {
      const delay = i * 26

      animations.push(
        el.animate(IN_KEYFRAMES, {
          duration: 380,
          easing: EASE,
          fill: 'forwards',
          delay,
        }),
      )

      animations.push(
        el.animate(BREATHE_KEYFRAMES, {
          duration: 3000,
          easing: EASE,
          iterations: Infinity,
          delay: delay + 820,
        }),
      )
    })

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

    return () => animations.forEach((a) => a.cancel())
  }, [])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-8"
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
              gap: '4px',
              gridTemplateColumns: `repeat(${PIXEL_PI_COLS}, 11px)`,
              gridTemplateRows: `repeat(${PIXEL_PI_ROW_COUNT}, 11px)`,
              justifyContent: 'center',
              padding: '20px 24px',
              borderRadius: '16px',
              background: 'var(--session-pixel-surface, #f3f3f3)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 12px 40px rgba(0,0,0,0.06)',
            } as React.CSSProperties
          }
          aria-hidden="true"
        >
          {PIXEL_CELLS.map((cell) => (
            <span
              key={cell.key}
              className={cell.on ? 'session-pixel session-pixel--on' : 'session-pixel session-pixel--off'}
              style={{
                width: '11px',
                height: '11px',
                borderRadius: '4px',
                background: cell.on ? 'var(--session-pixel-ink, #1a1a1a)' : 'transparent',
                opacity: cell.on ? 0 : 1,
                visibility: cell.on ? 'visible' : 'hidden',
                pointerEvents: 'none',
              }}
            />
          ))}
        </div>
        <p ref={captionRef} className="text-[13px] text-foreground-secondary" style={{ opacity: 0 }}>
          {t('timeline.loadingSession')}
        </p>
      </div>
    </div>
  )
}