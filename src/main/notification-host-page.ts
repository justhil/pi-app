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
      --surface: #f7f8fa;
      --surface-hover: #fcfcfd;
      --fg: #171a21;
      --muted: #5d6473;
      --subtle: #7a8291;
      --line: #dde0e6;
      --accent: #58658f;
      --accent-hover: #4d597f;
      --accent-fg: #f7f8fb;
      --danger: #c9294f;
      --shadow: 0 10px 28px rgb(24 29 41 / 16%);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --surface: #20232b;
        --surface-hover: #252932;
        --fg: #eceef2;
        --muted: #b0b6c3;
        --subtle: #8c95a5;
        --line: #353a46;
        --accent: #9aa6d1;
        --accent-hover: #aeb8dc;
        --accent-fg: #171a21;
        --danger: #ff6b8b;
        --shadow: 0 12px 30px rgb(0 0 0 / 30%);
      }
    }
    html, body {
      margin: 0;
      background: transparent;
      color: var(--fg);
      font: 13px/1.45 system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      overflow: hidden;
      user-select: none;
    }
    #stack { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
    .card {
      height: 168px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface);
      padding: 11px 12px 10px;
      box-shadow: var(--shadow);
      opacity: 0;
      transform: translateY(8px) scale(.985);
      animation: card-in 180ms cubic-bezier(.22,1,.36,1) forwards;
      transition: transform 120ms ease, opacity 120ms ease;
    }
    .card:hover { transform: translateY(-1px); background: var(--surface-hover); }
    .project {
      overflow: hidden;
      color: var(--subtle);
      font-size: 11px;
      letter-spacing: .025em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .title {
      overflow: hidden;
      font-size: 14px;
      font-weight: 650;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .body {
      display: -webkit-box;
      overflow: hidden;
      color: var(--muted);
      line-height: 1.4;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .meta {
      overflow: hidden;
      color: var(--subtle);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta.failed { color: var(--danger); }
    .actions { display: flex; gap: 6px; margin-top: auto; }
    button {
      min-height: 44px;
      min-width: 44px;
      border: 1px solid transparent;
      border-radius: 7px;
      padding: 0 10px;
      font: inherit;
      font-weight: 550;
      cursor: pointer;
      transition: transform 100ms ease, opacity 100ms ease;
    }
    button:hover { opacity: .9; }
    button:active { transform: scale(.98); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .open { flex: 1; background: var(--accent); color: var(--accent-fg); }
    .open:hover { background: var(--accent-hover); }
    .ghost { border-color: var(--line); background: transparent; color: var(--muted); }
    @keyframes card-in { to { opacity: 1; transform: translateY(0) scale(1); } }
    @media (prefers-reduced-motion: reduce) {
      .card { animation: none; opacity: 1; transform: none; transition: none; }
      button { transition: none; }
    }
  </style>
</head>
<body>
  <div id="stack"></div>
  <script>
    const api = window.piNotify
    const stack = document.getElementById('stack')
    const playedSoundIds = new Set()
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
        gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.18)
      } catch (e) {}
    }
    function render(cards) {
      const visibleIds = new Set(cards.map((card) => card.notificationId))
      for (const id of playedSoundIds) {
        if (!visibleIds.has(id)) playedSoundIds.delete(id)
      }
      stack.replaceChildren()
      for (const card of cards) {
        const el = document.createElement('article')
        el.className = 'card'
        el.dataset.id = card.notificationId
        const failed = card.outcome === 'failed'
        el.innerHTML =
          '<div class="project"></div><div class="title"></div><div class="body"></div><div class="meta"></div><div class="actions"></div>'
        el.querySelector('.project').textContent = card.copy.projectLabel
        el.querySelector('.title').textContent = card.copy.title
        el.querySelector('.body').textContent = card.copy.body
        const meta = el.querySelector('.meta')
        meta.textContent = card.copy.meta
        if (failed) meta.classList.add('failed')
        const actions = el.querySelector('.actions')
        const open = document.createElement('button')
        open.className = 'open'
        open.textContent = card.copy.openLabel
        open.addEventListener('click', () => api.action(card.notificationId, 'open'))
        const dismiss = document.createElement('button')
        dismiss.className = 'ghost'
        dismiss.textContent = card.copy.dismissLabel
        dismiss.addEventListener('click', () => api.action(card.notificationId, 'dismiss'))
        const mute = document.createElement('button')
        mute.className = 'ghost'
        mute.textContent = card.copy.muteLabel
        mute.addEventListener('click', () => api.action(card.notificationId, 'mute'))
        actions.append(dismiss, mute, open)
        el.addEventListener('mouseenter', () => api.hover(true))
        el.addEventListener('mouseleave', () => api.hover(false))
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
