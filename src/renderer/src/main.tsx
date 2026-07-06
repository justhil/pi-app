import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </QueryClientProvider>
  </React.StrictMode>,
)