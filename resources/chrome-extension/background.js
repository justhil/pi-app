// pi Desktop browser bridge (MV3 service worker). A thin relay: pi drives the DevTools protocol
// of tabs it opened in its own Agent window (or tabs the user lent it) through chrome.debugger,
// over a WebSocket to 127.0.0.1 that only a paired pi (port + token) can open.

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
}

const setStatus = (status) => {
  state.status = status
  chrome.storage.session.set({ status }).catch(() => {})
}

const send = (msg) => {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg))
}

async function connect() {
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
    send({ event: 'hello', params: { version: chrome.runtime.getManifest().version, ua: navigator.userAgent, extensionId: chrome.runtime.id } })
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
    }
  }
  const w = await chrome.windows.create({ url: url || 'about:blank', focused: false, width: 1280, height: 900 })
  state.agentWindowId = w.id
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
      await groupAgentTab(tab.id)
      return tabInfo(await chrome.tabs.get(tab.id))
    }
    case 'tabs.close':
      state.tabs.delete(p.tabId)
      await chrome.tabs.remove(p.tabId)
      return true
    case 'tabs.activate': {
      const tab = await chrome.tabs.update(p.tabId, { active: true })
      const win = await chrome.windows.get(tab.windowId)
      // A minimized window stops rendering: bring it back (without stealing focus unless asked).
      if (win.state === 'minimized' || p.focus) await chrome.windows.update(tab.windowId, { state: win.state === 'minimized' ? 'normal' : win.state, ...(p.focus ? { focused: true } : {}) })
      return true
    }
    case 'tabs.borrow': {
      const tab = await chrome.tabs.get(p.tabId)
      state.tabs.set(p.tabId, { sessionKey: p.sessionKey, borrowed: true })
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
      return true
    case 'debugger.detach':
      if (state.attached.has(p.tabId)) await chrome.debugger.detach({ tabId: p.tabId }).catch(() => {})
      state.attached.delete(p.tabId)
      return true
    case 'cdp':
      if (!state.tabs.has(p.tabId)) throw new Error('pi may only drive tabs it opened or borrowed')
      return chrome.debugger.sendCommand(p.sessionId ? { tabId: p.tabId, sessionId: p.sessionId } : { tabId: p.tabId }, p.method, p.params || {})
    case 'downloads.list':
      return (await chrome.downloads.search({ limit: 30, orderBy: ['-startTime'] })).map(mapDownload)
    case 'help.show':
      // The user is in Chrome when pi asks for help: answer right here, no need to switch to pi.
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
  state.attached.delete(source.tabId)
  send({ event: 'debugger.detached', params: { tabId: source.tabId, reason } })
})
chrome.tabs.onUpdated.addListener((tabId, _change, tab) => {
  if (state.tabs.has(tabId)) send({ event: 'tab.updated', params: tabInfo(tab) })
})
chrome.tabs.onRemoved.addListener((tabId) => {
  if (!state.tabs.has(tabId)) return
  state.tabs.delete(tabId)
  state.attached.delete(tabId)
  send({ event: 'tab.removed', params: { tabId } })
})
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === state.agentWindowId) {
    state.agentWindowId = null
    state.agentGroupId = null
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

// Keep the worker (and the socket) alive: an alarm wakes it, pings keep the socket busy.
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
chrome.runtime.onStartup.addListener(() => void connect())
chrome.runtime.onInstalled.addListener(() => void connect())
void connect()
