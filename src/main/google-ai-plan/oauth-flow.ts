import { createServer, type Server } from 'node:http'
import type { GoogleAiPlanClientConfig } from './sync-upstream-pr'

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const QUOTA_SCOPE = 'https://www.googleapis.com/auth/generative-language.peruserquota'
const SCOPES = `openid email profile ${QUOTA_SCOPE}`
const CALLBACK_PATH = '/oauth2callback'
const CALLBACK_TIMEOUT_MS = 10 * 60 * 1000

const encoder = new TextEncoder()

export interface EcPrivateJwk {
  kty: string
  crv: string
  x: string
  y: string
  d: string
}

export interface GoogleAiPlanOAuthCredential {
  type: 'oauth'
  access: string
  refresh: string
  expires: number
  dpopKey: EcPrivateJwk
  dpopNonce?: string
}

export type GoogleAiPlanLoginPhase =
  | 'idle'
  | 'awaiting_callback'
  | 'exchanging'
  | 'succeeded'
  | 'failed'

export interface GoogleAiPlanLoginSnapshot {
  active: boolean
  phase: GoogleAiPlanLoginPhase
  authUrl?: string
  redirectUri?: string
  error?: string
  startedAt?: number
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  id_token?: string
  error?: string
  error_description?: string
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url')
}

function randomToken(byteLength: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(32)
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(verifier))
  return { verifier, challenge: base64url(hash) }
}

async function createDpopKey(): Promise<EcPrivateJwk> {
  const { privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
  const { kty, crv, x, y, d } = await crypto.subtle.exportKey('jwk', privateKey)
  if (!kty || !crv || !x || !y || !d) throw new Error('Failed to export DPoP key')
  return { kty, crv, x, y, d }
}

async function createDpopProof(
  key: EcPrivateJwk,
  claims: { jti: string; nonce?: string; iat?: number },
): Promise<string> {
  const { kty, crv, x, y } = key
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: { kty, crv, x, y } }
  const { iat = Math.floor(Date.now() / 1000), ...rest } = claims
  const payload = { ...rest, htm: 'POST', htu: TOKEN_URL, iat }
  const input = `${base64url(encoder.encode(JSON.stringify(header)))}.${base64url(encoder.encode(JSON.stringify(payload)))}`
  const signingKey = await crypto.subtle.importKey('jwk', key, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, encoder.encode(input))
  return `${input}.${base64url(signature)}`
}

async function postToken(
  fetchImpl: typeof fetch,
  client: GoogleAiPlanClientConfig,
  params: Record<string, string>,
  dpop: string,
  signal: AbortSignal,
): Promise<{ status: number; body: TokenResponse; nonce?: string; serverTime?: number }> {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      DPoP: dpop,
    },
    body: new URLSearchParams({ ...params, client_id: client.clientId, client_secret: client.clientSecret }).toString(),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  })
  const text = await response.text()
  let body: TokenResponse
  try {
    body = JSON.parse(text) as TokenResponse
  } catch {
    body = { error: `HTTP ${response.status}`, error_description: text }
  }
  const serverTime = Date.parse(response.headers.get('date') ?? '')
  return {
    status: response.status,
    body,
    nonce: response.headers.get('dpop-nonce') ?? undefined,
    serverTime: Number.isNaN(serverTime) ? undefined : Math.floor(serverTime / 1000),
  }
}

function checkIdToken(idToken: string | undefined, nonce: string, clientId: string): void {
  if (!idToken) throw new Error('Google sign-in returned no ID token')
  const claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
    iss?: string
    aud?: string
    exp?: number
    nonce?: string
  }
  const issuerOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com'
  const notExpired = (claims.exp ?? 0) * 1000 > Date.now() - 60_000
  if (!issuerOk || claims.aud !== clientId || claims.nonce !== nonce || !notExpired) {
    throw new Error('Google sign-in returned an ID token that failed validation')
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function callbackHtml(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;padding:2.5rem;max-width:520px;margin:0 auto;color:#111"><h2 style="margin:0 0 .5rem">${escapeHtml(title)}</h2><p style="color:#555;line-height:1.6">${escapeHtml(body)}</p></body></html>`
}

export class GoogleAiPlanOAuthSession {
  private snapshot: GoogleAiPlanLoginSnapshot = { active: false, phase: 'idle' }
  private server: Server | null = null
  private abortController: AbortController | null = null
  private timeout: ReturnType<typeof setTimeout> | null = null
  private claimed = false
  private sessionParams: {
    client: GoogleAiPlanClientConfig
    verifier: string
    state: string
    nonce: string
    dpopKey: EcPrivateJwk
    redirectUri: string
    fetchImpl: typeof fetch
    onSuccess: (cred: GoogleAiPlanOAuthCredential) => Promise<void>
    onChange: (snap: GoogleAiPlanLoginSnapshot) => void
  } | null = null

  getSnapshot(): GoogleAiPlanLoginSnapshot {
    return { ...this.snapshot }
  }

  private emit(next: GoogleAiPlanLoginSnapshot): void {
    this.snapshot = next
    this.sessionParams?.onChange(this.getSnapshot())
  }

  async start(options: {
    client: GoogleAiPlanClientConfig
    fetchImpl?: typeof fetch
    onSuccess: (cred: GoogleAiPlanOAuthCredential) => Promise<void>
    onChange: (snap: GoogleAiPlanLoginSnapshot) => void
  }): Promise<GoogleAiPlanLoginSnapshot> {
    this.cancel()

    const { verifier, challenge } = await generatePkce()
    const state = randomToken(32)
    const nonce = randomToken(32)
    const dpopKey = await createDpopKey()
    const abortController = new AbortController()
    this.abortController = abortController
    this.claimed = false

    const server = createServer((req, res) => {
      void this.handleHttpCallback(req.method ?? 'GET', req.url ?? '/', res)
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('Failed to bind local OAuth callback server')
    }

    const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`
    const params = new URLSearchParams({
      client_id: options.client.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    })
    const authUrl = `${AUTHORIZE_URL}?${params.toString()}`

    this.server = server
    this.sessionParams = {
      client: options.client,
      verifier,
      state,
      nonce,
      dpopKey,
      redirectUri,
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
      onSuccess: options.onSuccess,
      onChange: options.onChange,
    }

    this.timeout = setTimeout(() => {
      this.fail('Google sign-in timed out. Please try again.')
    }, CALLBACK_TIMEOUT_MS)

    this.emit({
      active: true,
      phase: 'awaiting_callback',
      authUrl,
      redirectUri,
      startedAt: Date.now(),
    })

    return this.getSnapshot()
  }

  private async handleHttpCallback(
    method: string,
    rawUrl: string,
    res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void },
  ): Promise<void> {
    const send = (status: number, title: string, body: string) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(callbackHtml(title, body))
    }

    const url = new URL(rawUrl, 'http://localhost')
    if (method !== 'GET' || url.pathname !== CALLBACK_PATH) {
      send(404, 'Not found', 'Callback route not found.')
      return
    }
    const ctx = this.sessionParams
    if (!ctx || this.claimed) {
      send(409, 'Already handled', 'This sign-in session has already been handled.')
      return
    }
    if (url.searchParams.get('state') !== ctx.state) {
      send(400, 'State mismatch', 'The sign-in state parameter did not match. Please restart sign-in in pi Desktop.')
      return
    }
    const error = url.searchParams.get('error')
    if (error) {
      const desc = url.searchParams.get('error_description') ?? error
      send(400, 'Authorization cancelled', desc)
      this.fail(error === 'access_denied' ? 'Sign-in was cancelled' : `Google sign-in failed: ${desc}`)
      return
    }
    const code = url.searchParams.get('code')
    if (!code) {
      send(400, 'Missing authorization code', 'No authorization code was returned by Google.')
      return
    }

    this.claimed = true
    try {
      await this.completeCodeExchange(code)
      send(200, 'Sign-in complete', 'Signed in to Google AI Ultra plan. You can close this tab and return to pi Desktop.')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      send(502, 'Sign-in failed', msg)
    }
  }

  async submitManualUrl(rawInput: string): Promise<GoogleAiPlanLoginSnapshot> {
    const ctx = this.sessionParams
    if (!ctx || !this.snapshot.active) {
      throw new Error('No active Google sign-in session')
    }
    let parsed: URL
    try {
      parsed = new URL(rawInput.trim())
    } catch {
      throw new Error('Invalid callback URL')
    }
    if (parsed.searchParams.get('state') !== ctx.state) {
      throw new Error('Sign-in state mismatch')
    }
    const error = parsed.searchParams.get('error')
    if (error) {
      const msg = error === 'access_denied' ? 'Sign-in was cancelled' : `Google sign-in failed: ${error}`
      this.fail(msg)
      throw new Error(msg)
    }
    const code = parsed.searchParams.get('code')
    if (!code) {
      throw new Error('Missing authorization code in callback URL')
    }
    if (this.claimed) {
      return this.getSnapshot()
    }
    this.claimed = true
    await this.completeCodeExchange(code)
    return this.getSnapshot()
  }

  private async completeCodeExchange(code: string): Promise<void> {
    const ctx = this.sessionParams
    const signal = this.abortController?.signal
    if (!ctx || !signal) throw new Error('Sign-in session was cancelled')

    this.emit({
      ...this.snapshot,
      active: true,
      phase: 'exchanging',
      error: undefined,
    })

    try {
      const jti = base64url(await crypto.subtle.digest('SHA-256', encoder.encode(code)))
      const proofClaims: { jti: string; nonce?: string; iat?: number } = { jti }
      let result = await postToken(
        ctx.fetchImpl,
        ctx.client,
        {
          grant_type: 'authorization_code',
          code,
          code_verifier: ctx.verifier,
          redirect_uri: ctx.redirectUri,
        },
        await createDpopProof(ctx.dpopKey, proofClaims),
        signal,
      )
      for (let retry = 0; retry < 2; retry++) {
        if (result.body.error === 'use_dpop_nonce' && result.nonce && proofClaims.nonce !== result.nonce) {
          proofClaims.nonce = result.nonce
        } else if (result.body.error === 'invalid_dpop_proof' && proofClaims.iat === undefined && result.serverTime) {
          proofClaims.iat = result.serverTime
        } else {
          break
        }
        result = await postToken(
          ctx.fetchImpl,
          ctx.client,
          {
            grant_type: 'authorization_code',
            code,
            code_verifier: ctx.verifier,
            redirect_uri: ctx.redirectUri,
          },
          await createDpopProof(ctx.dpopKey, proofClaims),
          signal,
        )
      }

      const { status, body, nonce: respNonce } = result
      if (status !== 200 || !body.access_token || !body.refresh_token) {
        const msg = `Google sign-in failed: ${status} ${body.error ?? ''} ${body.error_description ?? ''}`.trim()
        throw new Error(msg)
      }
      if (!(body.scope ?? '').split(' ').includes(QUOTA_SCOPE)) {
        throw new Error('Google did not grant access to the Google AI Ultra plan. Try signing in again.')
      }
      checkIdToken(body.id_token, ctx.nonce, ctx.client.clientId)

      const credential: GoogleAiPlanOAuthCredential = {
        type: 'oauth',
        access: body.access_token,
        refresh: body.refresh_token,
        expires: Date.now() + (body.expires_in ?? 3599) * 1000,
        dpopKey: ctx.dpopKey,
        ...(respNonce ? { dpopNonce: respNonce } : {}),
      }

      await ctx.onSuccess(credential)
      const onChange = ctx.onChange
      this.cleanup()
      this.snapshot = { active: false, phase: 'succeeded' }
      onChange(this.getSnapshot())
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.fail(msg)
      throw err
    }
  }

  private fail(message: string): void {
    const onChange = this.sessionParams?.onChange
    this.cleanup()
    this.snapshot = { active: false, phase: 'failed', error: message }
    onChange?.(this.getSnapshot())
  }

  cancel(): void {
    const onChange = this.sessionParams?.onChange
    const wasActive = this.snapshot.active
    this.cleanup()
    this.snapshot = { active: false, phase: 'idle' }
    if (wasActive) onChange?.(this.getSnapshot())
  }

  private cleanup(): void {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    if (this.server) {
      try {
        this.server.close()
      } catch {
        /* ignore */
      }
      this.server = null
    }
    this.sessionParams = null
  }
}
