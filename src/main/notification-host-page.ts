/** Sandboxed notification host. No nodeIntegration; talks only via preload action ids. */
export function notificationHostPageHtml(): string {
  return `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; media-src 'none'" />
  <title>pi Desktop</title>
  <style>
    :root {
      color-scheme: light dark;
      --surface: rgba(251, 252, 253, 0.96);
      --surface-hover: #ffffff;
      --fg: #14171f;
      --muted: #576071;
      --subtle: #7d8696;
      --line: rgba(18, 24, 38, 0.11);
      --accent: #181c26;
      --accent-hover: #2c3345;
      --accent-fg: #f8fafc;
      --ok: #16a34a;
      --danger: #d9385a;
      --ghost-hover: rgba(18, 24, 38, 0.06);
      --shadow: 0 8px 22px rgba(15, 23, 42, 0.13), 0 1px 3px rgba(15, 23, 42, 0.07);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --surface: rgba(28, 31, 38, 0.96);
        --surface-hover: #232731;
        --fg: #eef1f6;
        --muted: #a6aebf;
        --subtle: #7f8899;
        --line: rgba(255, 255, 255, 0.11);
        --accent: #e5e9f2;
        --accent-hover: #ffffff;
        --accent-fg: #14171f;
        --ok: #4ade80;
        --danger: #fb7185;
        --ghost-hover: rgba(255, 255, 255, 0.09);
        --shadow: 0 10px 26px rgba(0, 0, 0, 0.42), 0 1px 3px rgba(0, 0, 0, 0.25);
      }
    }
    html, body {
      margin: 0;
      padding: 0;
      background: transparent;
      color: var(--fg);
      font: 12.5px/1.4 system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      overflow: hidden;
      user-select: none;
    }
    #stack {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 6px 10px 10px;
    }
    .card {
      position: relative;
      height: 104px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 3px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
      padding: 9px 11px 8px 13px;
      box-shadow: var(--shadow);
      cursor: pointer;
      transition: background-color 130ms ease, border-color 130ms ease, transform 140ms cubic-bezier(.16,1,.3,1);
    }
    .card.is-entering {
      opacity: 0;
      transform: translateX(12px) scale(.985);
      animation: card-in 175ms cubic-bezier(.16,1,.3,1) forwards;
    }
    .card::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--ok);
      opacity: .85;
    }
    .card.is-failed::before { background: var(--danger); }
    .card:hover {
      background: var(--surface-hover);
      transform: translateY(-1px);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      min-height: 18px;
    }
    .eyebrow {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      flex: 1;
      color: var(--subtle);
      font-size: 10.5px;
      letter-spacing: .01em;
    }
    .status-dot {
      width: 5px;
      height: 5px;
      border-radius: 999px;
      background: var(--ok);
      flex-shrink: 0;
    }
    .card.is-failed .status-dot { background: var(--danger); }
    .project {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }
    .meta {
      flex-shrink: 0;
      opacity: .85;
      white-space: nowrap;
    }
    .meta.failed { color: var(--danger); opacity: 1; }
    .top-tools {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
    }
    .title {
      overflow: hidden;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding-right: 4px;
    }
    .foot {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: auto;
      min-height: 24px;
    }
    .body {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      color: var(--muted);
      font-size: 11.5px;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    button {
      border: 1px solid transparent;
      border-radius: 6px;
      font: inherit;
      cursor: pointer;
      transition: background-color 110ms ease, color 110ms ease, opacity 110ms ease, transform 100ms ease;
    }
    button:active { transform: scale(.97); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .open {
      height: 24px;
      padding: 0 9px;
      flex-shrink: 0;
      font-size: 11.5px;
      font-weight: 550;
      background: var(--accent);
      color: var(--accent-fg);
    }
    .open:hover { background: var(--accent-hover); }
    .ghost {
      height: 20px;
      padding: 0 5px;
      font-size: 10.5px;
      color: var(--subtle);
      background: transparent;
    }
    .ghost:hover {
      background: var(--ghost-hover);
      color: var(--fg);
    }
    .progress {
      position: absolute;
      left: 3px;
      right: 0;
      bottom: 0;
      height: 2px;
      background: transparent;
      pointer-events: none;
    }
    .progress-bar {
      height: 100%;
      width: 100%;
      transform-origin: left center;
      background: var(--line);
      animation: timer-shrink var(--ttl, 8000ms) linear forwards;
    }
    .card:hover .progress-bar { animation-play-state: paused; }
    @keyframes card-in {
      to { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes timer-shrink {
      from { transform: scaleX(1); }
      to { transform: scaleX(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .card.is-entering { animation: none; opacity: 1; transform: none; }
      .card, button { transition: none; }
      .progress-bar { animation: none; }
    }
  </style>
</head>
<body>
  <div id="stack"></div>
  <script>
    const api = window.piNotify
    const stack = document.getElementById('stack')
    const playedSoundIds = new Set()
    const mountedCards = new Map()
    function beep() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext
        if (!Ctx) return
        const ctx = new Ctx()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = 880
        gain.gain.setValueAtTime(0.0001, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.16)
      } catch (e) {}
    }
    function buildCard(card) {
      const el = document.createElement('article')
      el.className = 'card is-entering'
      el.dataset.id = card.notificationId
      el.innerHTML =
        '<div class="head"><div class="eyebrow"><span class="status-dot"></span><span class="project"></span><span class="meta"></span></div><div class="top-tools"></div></div>' +
        '<div class="title"></div>' +
        '<div class="foot"><div class="body"></div></div>' +
        '<div class="progress"><div class="progress-bar"></div></div>'

      const topTools = el.querySelector('.top-tools')
      const mute = document.createElement('button')
      mute.className = 'ghost mute-btn'
      mute.addEventListener('click', (e) => {
        e.stopPropagation()
        api.action(card.notificationId, 'mute')
      })
      const dismiss = document.createElement('button')
      dismiss.className = 'ghost dismiss-btn'
      dismiss.addEventListener('click', (e) => {
        e.stopPropagation()
        api.action(card.notificationId, 'dismiss')
      })
      topTools.append(mute, dismiss)

      const foot = el.querySelector('.foot')
      const open = document.createElement('button')
      open.className = 'open'
      open.addEventListener('click', (e) => {
        e.stopPropagation()
        api.action(card.notificationId, 'open')
      })
      foot.append(open)

      el.addEventListener('click', () => api.action(card.notificationId, 'open'))
      el.addEventListener('mouseenter', () => api.hover(true))
      el.addEventListener('mouseleave', () => api.hover(false))
      el.addEventListener('animationend', () => el.classList.remove('is-entering'), { once: true })
      return el
    }
    function syncCard(el, card) {
      const failed = card.outcome === 'failed'
      el.classList.toggle('is-failed', failed)
      el.querySelector('.project').textContent = card.copy.projectLabel
      el.querySelector('.title').textContent = card.copy.title
      el.querySelector('.body').textContent = card.copy.body
      const meta = el.querySelector('.meta')
      meta.textContent = card.copy.meta ? '· ' + card.copy.meta : ''
      meta.classList.toggle('failed', failed)
      const open = el.querySelector('.open')
      open.textContent = card.copy.openLabel
      const mute = el.querySelector('.mute-btn')
      mute.textContent = card.copy.muteLabel
      mute.title = card.copy.muteLabel
      const dismiss = el.querySelector('.dismiss-btn')
      dismiss.textContent = '×'
      dismiss.title = card.copy.dismissLabel
      dismiss.setAttribute('aria-label', card.copy.dismissLabel)
      if (card.timeoutMs > 0) {
        el.style.setProperty('--ttl', card.timeoutMs + 'ms')
      }
    }
    function render(cards) {
      const visibleIds = new Set(cards.map((card) => card.notificationId))
      for (const id of playedSoundIds) {
        if (!visibleIds.has(id)) playedSoundIds.delete(id)
      }
      for (const [id, node] of mountedCards) {
        if (!visibleIds.has(id)) {
          node.remove()
          mountedCards.delete(id)
        }
      }
      for (const card of cards) {
        let el = mountedCards.get(card.notificationId)
        if (!el) {
          el = buildCard(card)
          mountedCards.set(card.notificationId, el)
        }
        syncCard(el, card)
        stack.append(el)
        if (card.sound && !playedSoundIds.has(card.notificationId)) {
          playedSoundIds.add(card.notificationId)
          beep()
        }
      }
    }
    api.onFocus(() => stack.querySelector('.card:last-child .open')?.focus())
    api.onUpdate(render)
    api.ready()
  </script>
</body>
</html>`
}
