const codeEl = document.getElementById('code')
const statusEl = document.getElementById('status')

const LABELS = {
  unpaired: 'Not paired yet.',
  connecting: 'Connecting to pi Desktop…',
  connected: 'Connected. The AI can now open tabs in its own window.',
  disconnected: 'pi Desktop is not reachable (is it running, with My Chrome turned on?). Retrying…',
  rejected: 'pi Desktop rejected the code. Copy a fresh one.',
}

async function showStatus() {
  const { status } = await chrome.storage.session.get('status')
  statusEl.textContent = LABELS[status] || LABELS.unpaired
  statusEl.className = status === 'connected' ? 'ok' : status === 'rejected' ? 'bad' : ''
}

document.getElementById('save').addEventListener('click', async () => {
  const m = /^pi-bridge:(\d{2,5}):([A-Za-z0-9_-]{16,128})$/.exec(codeEl.value.trim())
  if (!m) {
    statusEl.textContent = 'That is not a pairing code (pi-bridge:PORT:TOKEN).'
    statusEl.className = 'bad'
    return
  }
  await chrome.storage.local.set({ port: Number(m[1]), token: m[2] })
  codeEl.value = ''
  setTimeout(showStatus, 600)
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.status) void showStatus()
})
void showStatus()
