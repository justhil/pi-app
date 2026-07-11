import { Component, type ReactNode, type ErrorInfo } from 'react'
import i18n from '@renderer/lib/i18n'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  label?: string
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.label || 'global'}]`, error, info)
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: undefined })
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      const message = this.state.error?.message || i18n.t('common:errorBoundary.unknown')
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-xs text-destructive">
            {i18n.t('common:errorBoundary.renderFailed')}: {message}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-[var(--bg-hover)]"
            >
              {i18n.t('common:retry')}
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[11px] text-foreground-secondary hover:bg-[var(--bg-hover)]"
            >
              {i18n.t('common:reload')}
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
