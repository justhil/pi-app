const isZh = /^zh\b/i.test(navigator.language || '')

const T = isZh
  ? {
      unpaired: '未配对',
      connecting: '连接中…',
      connected: '已连接 pi Desktop',
      disconnected: '未连上桌面端',
      rejected: '配对码已失效',
      borrowActive: '将当前标签页借给 pi',
      borrowedAlready: '当前标签页已借给 pi',
      detachYellowBar: '消除调试黄条',
      returnAll: '全部归还',
      tabsHeading: 'pi 当前授权标签页',
      emptyTabs: '暂无已授权标签页',
      borrowedTag: '借用',
      agentTag: 'pi 窗口',
      returnOne: '归还',
      closeOne: '关闭',
      pairHint: '从 pi Desktop → 设置 → 浏览器 → 我的 Chrome 复制配对码粘贴：',
      connectBtn: '配对连接',
      rePairToggle: '更换配对码 ▾',
      badCode: '配对码格式不正确（应为 pi-bridge:端口:令牌）',
      detachedToast: '已释放调试连接，顶部黄条已消除',
    }
  : {
      unpaired: 'Unpaired',
      connecting: 'Connecting…',
      connected: 'Connected',
      disconnected: 'Disconnected',
      rejected: 'Token rejected',
      borrowActive: 'Lend current tab to pi',
      borrowedAlready: 'Current tab already lent',
      detachYellowBar: 'Dismiss debug bar',
      returnAll: 'Return all',
      tabsHeading: 'Tabs managed by pi',
      emptyTabs: 'No active pi tabs',
      borrowedTag: 'Borrowed',
      agentTag: 'pi win',
      returnOne: 'Return',
      closeOne: 'Close',
      pairHint: 'Paste pairing code from pi Desktop → Settings → Browser:',
      connectBtn: 'Pair',
      rePairToggle: 'Re-pair code ▾',
      badCode: 'Invalid pairing code (expected pi-bridge:PORT:TOKEN)',
      detachedToast: 'Detached debugger sessions',
    }

const $ = (id) => document.getElementById(id)
$('pairHint').textContent = T.pairHint
$('save').textContent = T.connectBtn
$('detachBtn').textContent = T.detachYellowBar
$('returnAllBtn').textContent = T.returnAll
$('tabsHeading').textContent = T.tabsHeading
$('togglePairBtn').textContent = T.rePairToggle

let forceShowPair = false

const rpc = (cmd, payload = {}) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage({ cmd, ...payload }, (res) => resolve(res || {}))
  })

async function render() {
  const st = await rpc('popup.state')
  const status = st.status || 'unpaired'
  const pill = $('statusPill')
  $('statusText').textContent = T[status] || T.unpaired
  pill.className = 'pill' + (status === 'connected' ? ' ok' : status === 'rejected' ? ' bad' : '')

  const paired = Boolean(st.paired)
  $('connectedPane').classList.toggle('hidden', !paired)
  $('togglePairBtn').classList.toggle('hidden', !paired)
  $('pairPane').classList.toggle('hidden', paired && !forceShowPair)

  if (!paired) return

  const activeTab = st.activeTab
  const canBorrow = activeTab && /^https?:/i.test(activeTab.url || '') && !activeTab.managed
  const borrowBtn = $('borrowBtn')
  borrowBtn.textContent = activeTab && activeTab.managed ? T.borrowedAlready : T.borrowActive
  borrowBtn.disabled = !canBorrow || status !== 'connected'

  $('detachBtn').disabled = !(st.attachedCount > 0)
  const list = Array.isArray(st.tabs) ? st.tabs : []
  $('returnAllBtn').disabled = !list.some((t) => t.borrowed)
  $('tabsCount').textContent = String(list.length)

  const box = $('tabList')
  box.innerHTML = ''
  if (list.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'hint'
    empty.style.textAlign = 'center'
    empty.style.padding = '10px 0'
    empty.textContent = T.emptyTabs
    box.appendChild(empty)
    return
  }

  for (const tab of list) {
    const row = document.createElement('div')
    row.className = 'tab-item'

    const title = document.createElement('div')
    title.className = 'tab-title'
    title.textContent = tab.title || tab.url || 'Untitled'
    title.title = tab.url || ''
    title.onclick = async () => {
      await rpc('popup.focusTab', { tabId: tab.tabId })
    }

    const tag = document.createElement('span')
    tag.className = 'tag'
    tag.textContent = tab.borrowed ? T.borrowedTag : T.agentTag

    const btn = document.createElement('button')
    btn.className = 'mini-btn'
    btn.textContent = tab.borrowed ? T.returnOne : T.closeOne
    btn.onclick = async () => {
      await rpc(tab.borrowed ? 'popup.returnTab' : 'popup.closeTab', { tabId: tab.tabId })
      void render()
    }

    row.append(title, tag, btn)
    box.appendChild(row)
  }
}

$('togglePairBtn').onclick = () => {
  forceShowPair = !forceShowPair
  void render()
}

$('borrowBtn').onclick = async () => {
  await rpc('popup.borrowActive')
  void render()
}

$('detachBtn').onclick = async () => {
  await rpc('popup.detachAll')
  $('msg').textContent = T.detachedToast
  void render()
}

$('returnAllBtn').onclick = async () => {
  await rpc('popup.returnAll')
  void render()
}

$('save').onclick = async () => {
  const m = /^pi-bridge:(\d{2,5}):([A-Za-z0-9_-]{16,128})$/.exec($('code').value.trim())
  if (!m) {
    $('msg').textContent = T.badCode
    return
  }
  await chrome.storage.local.set({ port: Number(m[1]), token: m[2] })
  $('code').value = ''
  forceShowPair = false
  setTimeout(render, 500)
}

chrome.storage.onChanged.addListener(() => void render())
void render()
