import React, { Suspense, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './styles/geist-mono.css'
import './styles/globals.css'
import './styles/scrollbar-overlay.css'
import { hydrateIconThemeFromSettings } from './components/icons'
import { hydrateLanguageFromSettings } from './lib/i18n'
import './lib/startup-toast-guard'
import { ensureExtensionUIChannel } from './lib/extension-ui-channel'
import { ensureAppUpdateNotify } from './lib/app-update-notify'
import { ipcClient } from './lib/ipc-client'

ensureExtensionUIChannel()
ensureAppUpdateNotify()

performance.mark('pi:boot-script')
const App = React.lazy(() => import('./app/app'))

/** Fade out and drop the cold-start splash from index.html (never blocks the UI for long). */
function dismissBootSplash(): void {
  const splash = document.getElementById('boot-splash')
  if (!splash || splash.dataset.leaving) return
  splash.dataset.leaving = 'true'
  window.setTimeout(() => splash.remove(), 240)
}
// Safety net: a render crash must not leave the opaque splash over the error UI.
window.setTimeout(dismissBootSplash, 15_000)

/** Commits together with App (same Suspense boundary), i.e. once the shell has painted. */
function BootSplashDismiss() {
  useEffect(() => {
    performance.mark('pi:app-commit')
    requestAnimationFrame(dismissBootSplash)
    // Lets the main process start its heavy warm-up only after the first paint.
    void ipcClient.invoke('app.shellReady').catch(() => {})
  }, [])
  return null
}

async function bootstrapRenderer(): Promise<void> {
  performance.mark('pi:hydrate-start')
  const [languageHydration, iconThemeHydration] = await Promise.allSettled([
    hydrateLanguageFromSettings(),
    hydrateIconThemeFromSettings(),
  ])
  if (languageHydration.status === 'rejected') {
    console.warn('[i18n] Unable to restore the saved startup language')
  }
  if (iconThemeHydration.status === 'rejected') {
    console.warn('[icons] Unable to restore the saved startup icon theme')
  }

  performance.mark('pi:render-start')
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Suspense fallback={null}>
        <App />
        <BootSplashDismiss />
      </Suspense>
    </React.StrictMode>,
  )
}

void bootstrapRenderer()
