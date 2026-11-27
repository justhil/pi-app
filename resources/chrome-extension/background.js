// pi Desktop browser bridge (MV3 service worker). A thin relay: pi drives the DevTools protocol
// of tabs it opened in its own Agent window (or tabs the user lent it) through chrome.debugger,
// over a WebSocket to 127.0.0.1 that only a paired pi (port + token) can open.
// v1.2.0: persists tab/window ownership in chrome.storage.session across MV3 worker restarts,
// auto-detaches chrome.debugger after idle to dismiss Chrome's yellow bar, and supports
// allowlisted per-domain cookie sync into pi Desktop's built-in browser (bypassing Windows v20 disk lock).

const IDLE_DETACH_MS = 15_000

const state = {
  ws: null,
  status: 'unpaired',
  retry: 0,
  retryTimer: null,
  agentWindowId: null,
  agentGroupId: null,
  /** tabId → { sessionKey, borrowed } for tabs pi may drive. */
  tabs: new Map(),
  attached: new Set(),
  detachTimers: new Map(),
  hydrated: false,
}

const setStatus = (status) => {
  state.status = status
  chrome.storage.session.set({ status }).catch(() => {})
}

function persistSessionState() {
  const tabsArr = [...state.tabs.entries()].map(([tabId, meta]) => [tabId, meta])
  chrome.storage.session
    .set({
      agentWindowId: state.agentWindowId,
      agentGroupId: state.agentGroupId,
      piTabs: tabsArr,
    })
    .catch(() => {})
}

async function hydrateSessionState() {
  if (state.hydrated) return
  state.hydrated = true
  try {
    const data = await chrome.storage.session.get(['agentWindowId', 'agentGroupId', 'piTabs'])
    if (typeof data.agentWindowId === 'number') state.agentWindowId = data.agentWindowId
    if (typeof data.agentGroupId === 'number') state.agentGroupId = data.agentGroupId
    if (Array.isArray(data.piTabs)) {
      const liveTabs = await chrome.tabs.query({}).catch(() => [])
      const liveIds = new Set(liveTabs.map((t) => t.id))
      for (const entry of data.piTabs) {
        if (Array.isArray(entry) && typeof entry[0] === 'number' && liveIds.has(entry[0]) && entry[1]) {
          state.tabs.set(entry[0], entry[1])
        }
      }
      persistSessionState()
    }
  } catch {
    /* ignore */
  }
}

function scheduleIdleDetach(tabId) {
  const prev = state.detachTimers.get(tabId)
  if (prev) clearTimeout(prev)
  const timer = setTimeout(() => {
    state.detachTimers.delete(tabId)
    if (!state.attached.has(tabId)) return
    state.attached.delete(tabId)
    chrome.debugger.detach({ tabId }).catch(() => {})
  }, IDLE_DETACH_MS)
  state.detachTimers.set(tabId, timer)
}

function clearIdleDetach(tabId) {
  const prev = state.detachTimers.get(tabId)
  if (prev) {
    clearTimeout(prev)
    state.detachTimers.delete(tabId)
  }
}

const send = (msg) => {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg))
}

async function connect() {
  await hydrateSessionState()
  const { port, token } = await chrome.storage.local.get(['port', 'token'])
  if (!port || !token) return setStatus('unpaired')
  if (state.ws && (state.ws.readyState === WebSocket.CONNECTING || state.ws.readyState === WebSocket.OPEN)) return
  clearTimeout(state.retryTimer)
  let ws
  try {
    ws = new WebSocket(`ws://127.0.0.1:${Number(port)}/chrome?token=${encodeURIComponent(token)}`)
  } catch {
    return scheduleRetry()
  }
  state.ws = ws
  setStatus('connecting')
  ws.onopen = () => {
    state.retry = 0
    setStatus('connected')
    send({
      event: 'hello',
      params: { version: chrome.runtime.getManifest().version, ua: navigator.userAgent, extensionId: chrome.runtime.id },
    })
  }
  ws.onmessage = (m) => void onMessage(m.data)
  ws.onclose = (e) => {
    if (state.ws !== ws) return
    state.ws = null
    setStatus(e.code === 4401 ? 'rejected' : 'disconnected')
    if (e.code !== 4401) scheduleRetry()
  }
  ws.onerror = () => {}
}

function scheduleRetry() {
  clearTimeout(state.retryTimer)
  state.retryTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** state.retry++))
}

async function onMessage(raw) {
  await hydrateSessionState()
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }
  if (msg.id === undefined) return
  try {
    const result = await handle(msg.method, msg.params || {})
    send({ id: msg.id, result: result === undefined ? null : result })
  } catch (e) {
    send({ id: msg.id, error: String((e && e.message) || e) })
  }
}

function tabInfo(t) {
  const meta = state.tabs.get(t.id)
  return {
    tabId: t.id,
    windowId: t.windowId,
    url: t.url || t.pendingUrl || '',
    title: t.title || '',
    loading: t.status === 'loading',
    active: !!t.active,
    sessionKey: meta ? meta.sessionKey : null,
    borrowed: !!(meta && meta.borrowed),
    agentWindow: t.windowId === state.agentWindowId,
  }
}

async function agentWindow(url) {
  if (state.agentWindowId !== null) {
    try {
      await chrome.windows.get(state.agentWindowId)
      return { id: state.agentWindowId }
    } catch {
      state.agentWindowId = null
      state.agentGroupId = null
      persistSessionState()
    }
  }
  const w = await chrome.windows.create({ url: url || 'about:blank', focused: false, width: 1280, height: 900 })
  state.agentWindowId = w.id
  persistSessionState()
  return { id: w.id, first: w.tabs && w.tabs[0] }
}

async function groupAgentTab(tabId) {
  try {
    if (state.agentGroupId !== null) {
      await chrome.tabs.group({ tabIds: [tabId], groupId: state.agentGroupId })
      return
    }
  } catch {
    state.agentGroupId = null
  }
  try {
    state.agentGroupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: state.agentWindowId } })
    await chrome.tabGroups.update(state.agentGroupId, { title: 'pi', color: 'blue' })
    persistSessionState()
  } catch {
    /* groups are cosmetic */
  }
}

const mapDownload = (d) => ({
  id: `chrome-${d.id}`,
  url: d.finalUrl || d.url,
  fileName: (d.filename || '').split(/[\\/]/).pop() || '',
  savePath: d.filename || '',
  received: d.bytesReceived || 0,
  total: d.totalBytes > 0 ? d.totalBytes : 0,
  speed: 0,
  state: d.state === 'complete' ? 'completed' : d.state === 'interrupted' ? (d.error === 'USER_CANCELED' ? 'cancelled' : 'failed') : 'progressing',
  via: 'chrome',
  startedAt: Date.parse(d.startTime) || Date.now(),
  ...(d.error ? { error: d.error } : {}),
})

function registrableSite(domain) {
  const host = String(domain || '').replace(/^\./, '').toLowerCase()
  if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host
  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) return host
  return parts.slice(-2).join('.')
}

async function handle(method, p) {
  switch (method) {
    case 'ping':
      return 'pong'
    case 'tabs.list':
      return (await chrome.tabs.query({})).map(tabInfo)
    case 'tabs.create': {
      const w = await agentWindow(p.url)
      const tab = w.first || (await chrome.tabs.create({ windowId: w.id, url: p.url || 'about:blank', active: true }))
      state.tabs.set(tab.id, { sessionKey: p.sessionKey, borrowed: false })
      persistSessionState()
      await groupAgentTab(tab.id)
      return tabInfo(await chrome.tabs.get(tab.id))
    }
    case 'tabs.close':
      state.tabs.delete(p.tabId)
      clearIdleDetach(p.tabId)
      persistSessionState()
      await chrome.tabs.remove(p.tabId)
      return true
    case 'tabs.activate': {
      const tab = await chrome.tabs.update(p.tabId, { active: true })
      const win = await chrome.windows.get(tab.windowId)
      if (win.state === 'minimized' || p.focus) {
        await chrome.windows.update(tab.windowId, { state: win.state === 'minimized' ? 'normal' : win.state, ...(p.focus ? { focused: true } : {}) })
      }
      return true
    }
    case 'tabs.borrow': {
      const tab = await chrome.tabs.get(p.tabId)
      state.tabs.set(p.tabId, { sessionKey: p.sessionKey, borrowed: true })
      persistSessionState()
      try {
        const gid = await chrome.tabs.group({ tabIds: [p.tabId] })
        await chrome.tabGroups.update(gid, { title: 'pi (borrowed)', color: 'orange' })
      } catch {
        /* cosmetic */
      }
      return tabInfo(tab)
    }
    case 'tabs.return': {
      const meta = state.tabs.get(p.tabId)
      state.tabs.delete(p.tabId)
      clearIdleDetach(p.tabId)
      persistSessionState()
      if (state.attached.has(p.tabId)) await chrome.debugger.detach({ tabId: p.tabId }).catch(() => {})
      if (meta && meta.borrowed) await chrome.tabs.ungroup(p.tabId).catch(() => {})
      return true
    }
    case 'debugger.attach':
      if (!state.tabs.has(p.tabId)) throw new Error('pi may only drive tabs it opened or borrowed')
      if (!state.attached.has(p.tabId)) {
        await chrome.debugger.attach({ tabId: p.tabId }, '1.3')
        state.attached.add(p.tabId)
      }
      scheduleIdleDetach(p.tabId)
      return true
    case 'debugger.detach':
      clearIdleDetach(p.tabId)
      if (state.attached.has(p.tabId)) await chrome.debugger.detach({ tabId: p.tabId }).catch(() => {})
      state.attached.delete(p.tabId)
      return true
    case 'cdp':
      if (!state.tabs.has(p.tabId)) throw new Error('pi may only drive tabs it opened or borrowed')
      if (!state.attached.has(p.tabId)) {
        await chrome.debugger.attach({ tabId: p.tabId }, '1.3')
        state.attached.add(p.tabId)
      }
      scheduleIdleDetach(p.tabId)
      return chrome.debugger.sendCommand(p.sessionId ? { tabId: p.tabId, sessionId: p.sessionId } : { tabId: p.tabId }, p.method, p.params || {})
    case 'cookies.listSites': {
      if (!chrome.cookies) throw new Error('Extension needs cookies permission (reload extension in chrome://extensions)')
      const all = await chrome.cookies.getAll({})
      const counts = new Map()
      for (const c of all) {
        const site = registrableSite(c.domain)
        if (site) counts.set(site, (counts.get(site) || 0) + 1)
      }
      return [...counts.entries()]
        .map(([site, count]) => ({ site, count }))
        .sort((a, b) => b.count - a.count || a.site.localeCompare(b.site))
        .slice(0, 120)
    }
    case 'cookies.getForSites': {
      if (!chrome.cookies) throw new Error('Extension needs cookies permission')
      const wanted = new Set((Array.isArray(p.sites) ? p.sites : []).map((s) => String(s).toLowerCase()))
      if (wanted.size === 0) return []
      const all = await chrome.cookies.getAll({})
      return all
        .filter((c) => wanted.has(registrableSite(c.domain)))
        .map((c) => ({
          domain: c.domain,
          name: c.name,
          value: c.value,
          path: c.path || '/',
          secure: !!c.secure,
          httpOnly: !!c.httpOnly,
          sameSite: c.sameSite === 'strict' ? 'strict' : c.sameSite === 'no_restriction' ? 'no_restriction' : 'lax',
          expires: typeof c.expirationDate === 'number' ? c.expirationDate : undefined,
        }))
    }
    case 'downloads.list':
      return (await chrome.downloads.search({ limit: 30, orderBy: ['-startTime'] })).map(mapDownload)
    case 'help.show':
      await chrome.notifications.create(`pi-help-${p.id}`, {
        type: 'basic',
        iconUrl: 'icon128.png',
        title: p.title || 'pi',
        message: String(p.message || '').slice(0, 500),
        buttons: [{ title: p.yes || 'Done' }, { title: p.no || 'Give up' }],
        requireInteraction: true,
        priority: 2,
      })
      return true
    case 'help.clear':
      await chrome.notifications.clear(`pi-help-${p.id}`).catch(() => {})
      return true
    default:
      throw new Error(`unknown method ${method}`)
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  send({ event: 'cdp.event', params: { tabId: source.tabId, sessionId: source.sessionId, method, params } })
})
chrome.debugger.onDetach.addListener((source, reason) => {
  clearIdleDetach(source.tabId)
  state.attached.delete(source.tabId)
  send({ event: 'debugger.detached', params: { tabId: source.tabId, reason } })
})
chrome.tabs.onUpdated.addListener((tabId, _change, tab) => {
  if (state.tabs.has(tabId)) send({ event: 'tab.updated', params: tabInfo(tab) })
})
chrome.tabs.onRemoved.addListener((tabId) => {
  if (!state.tabs.has(tabId)) return
  state.tabs.delete(tabId)
  clearIdleDetach(tabId)
  state.attached.delete(tabId)
  persistSessionState()
  send({ event: 'tab.removed', params: { tabId } })
})
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === state.agentWindowId) {
    state.agentWindowId = null
    state.agentGroupId = null
    persistSessionState()
  }
})
const relayDownload = async (id) => {
  const [d] = await chrome.downloads.search({ id })
  if (d) send({ event: 'download.updated', params: mapDownload(d) })
}
chrome.notifications.onButtonClicked.addListener((notificationId, index) => {
  if (!notificationId.startsWith('pi-help-')) return
  send({ event: 'help.respond', params: { id: notificationId.slice('pi-help-'.length), outcome: index === 0 ? 'completed' : 'cancelled' } })
  void chrome.notifications.clear(notificationId)
})
chrome.downloads.onCreated.addListener((d) => void relayDownload(d.id))
chrome.downloads.onChanged.addListener((delta) => void relayDownload(delta.id))

chrome.alarms.create('pi-keepalive', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== 'pi-keepalive') return
  if (state.ws && state.ws.readyState === WebSocket.OPEN) send({ event: 'ping' })
  else void connect()
})
setInterval(() => send({ event: 'ping' }), 20_000)

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || (!changes.port && !changes.token)) return
  if (state.ws) state.ws.close()
  state.ws = null
  state.retry = 0
  void connect()
})
// Local Popup control RPCs (Borrow current tab, Detach yellow debug bar, Return tabs)
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  void (async () => {
    await hydrateSessionState()
    const { port, token } = await chrome.storage.local.get(['port', 'token'])
    const paired = Boolean(port && token)
    if (!req || typeof req.cmd !== 'string') return sendResponse({})

    if (req.cmd === 'popup.state') {
      const allTabs = await chrome.tabs.query({}).catch(() => [])
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => [])
      const managed = allTabs.filter((t) => state.tabs.has(t.id)).map(tabInfo)
      return sendResponse({
        paired,
        status: state.status,
        attachedCount: state.attached.size,
        tabs: managed,
        activeTab: active
          ? { tabId: active.id, url: active.url || '', title: active.title || '', managed: state.tabs.has(active.id) }
          : null,
      })
    }
    if (req.cmd === 'popup.borrowActive') {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => [])
      if (!active || !active.id) return sendResponse({ ok: false })
      const info = await handle('tabs.borrow', { tabId: active.id, sessionKey: 'shared' })
      send({ event: 'tab.updated', params: info })
      return sendResponse({ ok: true, tab: info })
    }
    if (req.cmd === 'popup.detachAll') {
      for (const tabId of [...state.attached]) {
        clearIdleDetach(tabId)
        state.attached.delete(tabId)
        await chrome.debugger.detach({ tabId }).catch(() => {})
      }
      return sendResponse({ ok: true })
    }
    if (req.cmd === 'popup.returnTab' && typeof req.tabId === 'number') {
      await handle('tabs.return', { tabId: req.tabId })
      send({ event: 'tab.removed', params: { tabId: req.tabId } })
      return sendResponse({ ok: true })
    }
    if (req.cmd === 'popup.closeTab' && typeof req.tabId === 'number') {
      await handle('tabs.close', { tabId: req.tabId })
      send({ event: 'tab.removed', params: { tabId: req.tabId } })
      return sendResponse({ ok: true })
    }
    if (req.cmd === 'popup.focusTab' && typeof req.tabId === 'number') {
      await handle('tabs.activate', { tabId: req.tabId, focus: true })
      return sendResponse({ ok: true })
    }
    if (req.cmd === 'popup.returnAll') {
      for (const [tabId, meta] of [...state.tabs.entries()]) {
        if (meta && meta.borrowed) {
          await handle('tabs.return', { tabId })
          send({ event: 'tab.removed', params: { tabId } })
        }
      }
      return sendResponse({ ok: true })
    }
    sendResponse({})
  })()
  return true
})

chrome.runtime.onStartup.addListener(() => void connect())
chrome.runtime.onInstalled.addListener(() => void connect())
void connect()
