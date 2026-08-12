import type { ReactNode } from 'react'
import { contextMessageBodyScrollProps } from './context-message-body-scroll'

export function ContextMessageBody({ children }: { children: ReactNode }) {
  return (
    <pre {...contextMessageBodyScrollProps} data-testid="context-message-body">
      {children}
    </pre>
  )
}
