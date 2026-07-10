import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import './styles/geist-mono.css'
import './styles/globals.css'
import './styles/scrollbar-overlay.css'
import './lib/i18n'
import './lib/startup-toast-guard'
import { ensureExtensionUIChannel } from './lib/extension-ui-channel'
import { ensureAppUpdateNotify } from './lib/app-update-notify'
import { syncChatContentMaxWidths } from './lib/chat-content-width'

ensureExtensionUIChannel()
ensureAppUpdateNotify()
syncChatContentMaxWidths()

const App = React.lazy(() => import('./app/app'))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </React.StrictMode>,
)
