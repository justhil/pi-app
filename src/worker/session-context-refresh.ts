/**
 * After moving the session tree tip, make the next request use that branch. Since pi 0.87 the
 * SessionManager is canonical: assigning agent.state.messages no longer changes what is sent,
 * so call session.refreshContext() (falling back to the assignment on older SDKs).
 */
export function refreshAgentContext(session: { refreshContext?: () => void; agent?: { state?: { messages?: unknown } } }, messages: unknown): void {
  if (typeof session.refreshContext === 'function') session.refreshContext()
  else if (session.agent?.state) session.agent.state.messages = messages
}
