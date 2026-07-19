import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import './styles/geist-mono.css'
import './styles/globals.css'
import './styles/scrollbar-overlay.css'
import { hydrateLanguageFromSettings } from './lib/i18n'
import './lib/startup-toast-guard'
import { ensureExtensionUIChannel } from './lib/extension-ui-channel'
import { ensureAppUpdateNotify } from './lib/app-update-notify'
import { syncChatContentMaxWidths } from './lib/chat-content-width'

ensureExtensionUIChannel()
ensureAppUpdateNotify()
syncChatContentMaxWidths()

const App = React.lazy(() => import('./app/app'))

async function bootstrapRenderer(): Promise<void> {
  try {
    await hydrateLanguageFromSettings()
  } catch {
    console.warn('[i18n] Unable to restore the saved startup language')
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </React.StrictMode>,
  )
}

void bootstrapRenderer()
