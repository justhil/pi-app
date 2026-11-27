import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildExtensionFiles,
  extractCatalogModelsFromSource,
  extractClientCredentialsFromSource,
  fetchAndInstallGoogleAiPlanExtension,
  readInstalledGoogleAiPlanExtension,
  removeGoogleAiPlanExtensionDir,
  transformGoogleInteractionsSource,
  transformGoogleOAuthSource,
} from '../sync-upstream-pr'
import { GoogleAiPlanOAuthSession } from '../oauth-flow'
import type { ModelEntry } from '../../active-sdk-models-core'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: vi.fn() },
}))

vi.mock('../../wsl/runtime-config', () => ({
  isWslRuntimeActive: () => false,
}))

vi.mock('../../worker-manager', () => ({
  workerManager: {
    isRunning: false,
    reloadResources: vi.fn(),
    reloadModels: vi.fn(),
  },
}))

const SAMPLE_CLIENT_IDENTITY = `
export interface GoogleAiPlanClient {
  clientId: string;
  clientSecret: string;
}
export const PI_GOOGLE_AI_PLAN_CLIENT: GoogleAiPlanClient = {
  clientId: "1234567890-testclient.apps.googleusercontent.com",
  clientSecret: "TEST_SECRET_VALUE_NOT_REAL",
};
`

const SAMPLE_CATALOG = `
const GEMINI_4_XHIGH: ThinkingLevelMap = {
  off: null,
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: null,
};
const GEMINI_4: ThinkingLevelMap = {
  off: null,
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
  max: null,
};
const FLASH_LITE: ThinkingLevelMap = {
  off: null,
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
  max: null,
};
const MODELS = [
  { id: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen", thinkingLevelMap: GEMINI_4_XHIGH },
  { id: "gemini-4-neon", name: "Gemini 4 Neon", thinkingLevelMap: GEMINI_4_XHIGH },
  { id: "gemini-4-carbon", name: "Gemini 4 Carbon", thinkingLevelMap: GEMINI_4 },
  { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", thinkingLevelMap: FLASH_LITE },
];
`

const SAMPLE_INTERACTIONS_ERRORS = `
export class GoogleInteractionsHttpError extends Error {
  status: number;
  headers: Headers;
  constructor(status: number, message: string, headers: Headers) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}
`

const SAMPLE_INTERACTIONS = `
import type { Interactions } from "@google/genai";
import { getIdentityHeaders } from "../identity.js";
import type { Model, SimpleStreamOptions, StreamFunction } from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { SseDecoder } from "../utils/sse.js";
import { parseToolCallArguments, ToolCallArgumentsStream } from "../utils/tool-call-arguments.js";
import { GoogleInteractionsHttpError } from "./google-interactions-errors.js";
import { resolveGoogleThinkingLevel } from "./google-shared.js";

type Step = Interactions.Step;
type SseEvent = Interactions.InteractionSSEEvent;

export const stream: StreamFunction<"google-interactions", any> = (model: Model<"google-interactions">) => {
  void getIdentityHeaders(model);
  void new SseDecoder();
  void new ToolCallArgumentsStream();
  void parseToolCallArguments("{}");
  void resolveGoogleThinkingLevel(model, "xhigh");
  void GoogleInteractionsHttpError;
  return new AssistantMessageEventStream();
};

export const streamSimple: StreamFunction<"google-interactions", SimpleStreamOptions> = (model, context, options) =>
  stream(model, context, options);
`

const SAMPLE_OAUTH = `
import type { OAuthProviderInterface } from "../types.js";
import { startOAuthCallbackServer, waitForCallbackOrManualInput } from "./callback-server.js";
import { generatePKCE } from "./pkce.js";

export interface GoogleAiPlanClient {
  clientId: string;
  clientSecret: string;
}

export function createGoogleAiPlanOAuth(client: GoogleAiPlanClient): OAuthProviderInterface {
  return {
    id: "google-ai-plan",
    name: "Google AI Ultra plan",
    async login() {
      void startOAuthCallbackServer;
      void waitForCallbackOrManualInput;
      await generatePKCE();
      return { access: "a", refresh: "r", expires: Date.now() + 3600_000 };
    },
    async refreshToken(c) {
      return c;
    },
    getApiKey(c) {
      return c.access;
    },
  };
}
`

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-google-ai-plan-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('sync-upstream-pr', () => {
  it('extracts client credentials and catalog models from upstream sources', () => {
    const client = extractClientCredentialsFromSource(SAMPLE_CLIENT_IDENTITY)
    expect(client).toEqual({
      clientId: '1234567890-testclient.apps.googleusercontent.com',
      clientSecret: 'TEST_SECRET_VALUE_NOT_REAL',
    })

    const models = extractCatalogModelsFromSource(SAMPLE_CATALOG)
    expect(models.map((m) => m.id)).toEqual([
      'gemini-4-hydrogen',
      'gemini-4-neon',
      'gemini-4-carbon',
      'gemini-3.5-flash-lite',
    ])
    expect(models[0].thinkingLevelMap.xhigh).toBe('xhigh')
    expect(models[2].thinkingLevelMap.xhigh).toBeNull()
    expect(models[3].thinkingLevelMap.minimal).toBe('minimal')
  })

  it('rewrites upstream imports cleanly to local compat helpers', () => {
    const transformedInteractions = transformGoogleInteractionsSource(SAMPLE_INTERACTIONS)
    expect(transformedInteractions).not.toContain('@google/genai')
    expect(transformedInteractions).toContain('from "./compat-helpers.ts"')
    expect(transformedInteractions).toContain('from "./google-interactions-errors.js"')
    expect(transformedInteractions).not.toContain('Interactions.')

    const transformedOAuth = transformGoogleOAuthSource(SAMPLE_OAUTH)
    expect(transformedOAuth).toContain('from "@earendil-works/pi-ai"')
    expect(transformedOAuth).toContain('from "./oauth-helpers.ts"')
  })

  it('fetches PR files over HTTPS (with branch fallback on API error), installs atomically, and reads status', async () => {
    const agentDir = makeTempDir()
    const fetchedUrls: string[] = []
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input)
      fetchedUrls.push(url)
      if (url.includes('api.github.com')) {
        return new Response('rate limit', { status: 403 })
      }
      if (url.endsWith('google-interactions-errors.ts')) return new Response(SAMPLE_INTERACTIONS_ERRORS, { status: 200 })
      if (url.endsWith('google-interactions.ts')) return new Response(SAMPLE_INTERACTIONS, { status: 200 })
      if (url.endsWith('oauth/google-ai-plan.ts')) return new Response(SAMPLE_OAUTH, { status: 200 })
      if (url.endsWith('providers/google-ai-plan.ts')) return new Response(SAMPLE_CATALOG, { status: 200 })
      if (url.endsWith('client-identity.ts')) return new Response(SAMPLE_CLIENT_IDENTITY, { status: 200 })
      return new Response('not found', { status: 404 })
    }

    const res = await fetchAndInstallGoogleAiPlanExtension(agentDir, { fetchImpl: mockFetch })
    expect(res.meta.ref).toBe('google-ai-plan')
    expect(res.meta.models).toHaveLength(4)
    expect(fetchedUrls.some((u) => u.includes('raw.githubusercontent.com/earendil-works/pi/google-ai-plan/'))).toBe(true)

    const installed = readInstalledGoogleAiPlanExtension(agentDir)
    expect(installed.installed).toBe(true)
    expect(installed.managedByApp).toBe(true)
    expect(installed.client?.clientId).toBe('1234567890-testclient.apps.googleusercontent.com')
    expect(installed.models).toHaveLength(4)

    expect(removeGoogleAiPlanExtensionDir(agentDir)).toBe(true)
    expect(readInstalledGoogleAiPlanExtension(agentDir).installed).toBe(false)
  })

  it('loads the generated extension inside real bundled @earendil-works/pi-coding-agent@1.0.2', async () => {
    const agentDir = makeTempDir()
    const cwd = makeTempDir()
    const extDir = join(agentDir, 'extensions', 'google-ai-plan')
    mkdirSync(extDir, { recursive: true })

    const { files } = buildExtensionFiles({
      repo: 'earendil-works/pi',
      ref: 'google-ai-plan',
      sha: '628d2ccabbb9df625c2d6035c44172b6776232d2',
      interactionsErrorsTs: SAMPLE_INTERACTIONS_ERRORS,
      interactionsTs: SAMPLE_INTERACTIONS,
      oauthTs: SAMPLE_OAUTH,
      catalogTs: SAMPLE_CATALOG,
      clientIdentityTs: SAMPLE_CLIENT_IDENTITY,
    })
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(extDir, name), content, 'utf8')
    }

    const { createAgentSessionServices } = await import('@earendil-works/pi-coding-agent')
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
    })

    const extResult = services.resourceLoader.getExtensions()
    expect(extResult.errors).toEqual([])

    const models = services.modelRuntime.getModels().filter((m) => m.provider === 'google-ai-plan')
    expect(models.map((m) => m.id).sort()).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-4-carbon',
      'gemini-4-hydrogen',
      'gemini-4-neon',
    ])
  }, 30_000)
})

describe('GoogleAiPlanOAuthSession', () => {
  function makeJwt(payload: Record<string, unknown>): string {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `${h}.${p}.sig`
  }

  it('completes loopback HTTP callback with DPoP nonce retry and validates ID token', async () => {
    const session = new GoogleAiPlanOAuthSession()
    const client = {
      clientId: 'client-id-123',
      clientSecret: 'client-secret-456',
    }
    let receivedCred: any = null
    const dpopHeaders: string[] = []
    let tokenCalls = 0
    let nonceFromAuth = ''

    const mockFetch: typeof fetch = async (_url, init) => {
      tokenCalls += 1
      const headers = init?.headers as Record<string, string>
      dpopHeaders.push(headers.DPoP)
      if (tokenCalls === 1) {
        return new Response(JSON.stringify({ error: 'use_dpop_nonce' }), {
          status: 400,
          headers: { 'dpop-nonce': 'server-nonce-1' },
        })
      }
      return new Response(
        JSON.stringify({
          access_token: 'access-abc',
          refresh_token: 'refresh-xyz',
          expires_in: 3600,
          scope: 'openid email https://www.googleapis.com/auth/generative-language.peruserquota',
          id_token: makeJwt({
            iss: 'https://accounts.google.com',
            aud: client.clientId,
            nonce: nonceFromAuth,
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        }),
        { status: 200, headers: { 'dpop-nonce': 'server-nonce-2' } },
      )
    }

    const snap = await session.start({
      client,
      fetchImpl: mockFetch,
      onSuccess: async (cred) => {
        receivedCred = cred
      },
      onChange: () => {},
    })
    expect(snap.active).toBe(true)
    expect(snap.authUrl).toBeTruthy()
    expect(snap.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/)

    const parsedAuth = new URL(snap.authUrl!)
    const state = parsedAuth.searchParams.get('state')!
    nonceFromAuth = parsedAuth.searchParams.get('nonce')!
    expect(parsedAuth.searchParams.get('code_challenge_method')).toBe('S256')

    const cbRes = await fetch(`${snap.redirectUri}?code=auth-code-999&state=${encodeURIComponent(state)}`)
    expect(cbRes.status).toBe(200)

    expect(tokenCalls).toBe(2)
    expect(receivedCred).not.toBeNull()
    expect(receivedCred.type).toBe('oauth')
    expect(receivedCred.access).toBe('access-abc')
    expect(receivedCred.refresh).toBe('refresh-xyz')
    expect(receivedCred.dpopNonce).toBe('server-nonce-2')
    expect(receivedCred.dpopKey.d).toBeTruthy()

    // Ensure DPoP header contains ONLY public JWK fields (no private `d`)
    const dpopHeader = JSON.parse(Buffer.from(dpopHeaders[1].split('.')[0], 'base64url').toString('utf8'))
    expect(dpopHeader.jwk.d).toBeUndefined()
    expect(dpopHeader.jwk.kty).toBe('EC')
    const dpopPayload = JSON.parse(Buffer.from(dpopHeaders[1].split('.')[1], 'base64url').toString('utf8'))
    expect(dpopPayload.nonce).toBe('server-nonce-1')

    expect(session.getSnapshot().phase).toBe('succeeded')
  })

  it('rejects manual callback URL when state mismatches', async () => {
    const session = new GoogleAiPlanOAuthSession()
    await session.start({
      client: { clientId: 'cid', clientSecret: 'csec' },
      onSuccess: async () => {},
      onChange: () => {},
    })
    await expect(
      session.submitManualUrl('http://127.0.0.1:12345/oauth2callback?code=abc&state=wrong'),
    ).rejects.toThrow(/state mismatch/i)
    session.cancel()
  })
})

describe('auth.json storage & cold-start model augmentation', () => {
  it('writes/reads/deletes google-ai-plan credential without clobbering other providers', async () => {
    const {
      augmentModelsWithGoogleAiPlan,
      deleteGoogleAiPlanAuth,
      readGoogleAiPlanAuth,
      writeGoogleAiPlanAuth,
    } = await import('../service')

    const agentDir = makeTempDir()
    writeFileSync(
      join(agentDir, 'auth.json'),
      JSON.stringify({ anthropic: { type: 'api_key', key: 'sk-ant-keep' } }, null, 2),
      'utf8',
    )

    expect(readGoogleAiPlanAuth(agentDir)).toEqual({ signedIn: false, expiresAt: null })

    writeGoogleAiPlanAuth(agentDir, {
      type: 'oauth',
      access: 'acc',
      refresh: 'ref',
      expires: 9999999999999,
      dpopKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' },
    })

    expect(readGoogleAiPlanAuth(agentDir)).toEqual({ signedIn: true, expiresAt: 9999999999999 })
    const rawAfterWrite = JSON.parse(readFileSync(join(agentDir, 'auth.json'), 'utf8'))
    expect(rawAfterWrite.anthropic.key).toBe('sk-ant-keep')

    // Install extension so cold-start projection kicks in
    const extDir = join(agentDir, 'extensions', 'google-ai-plan')
    mkdirSync(extDir, { recursive: true })
    const { files } = buildExtensionFiles({
      repo: 'earendil-works/pi',
      ref: 'google-ai-plan',
      sha: 'abcdef1234567',
      interactionsErrorsTs: SAMPLE_INTERACTIONS_ERRORS,
      interactionsTs: SAMPLE_INTERACTIONS,
      oauthTs: SAMPLE_OAUTH,
      catalogTs: SAMPLE_CATALOG,
      clientIdentityTs: SAMPLE_CLIENT_IDENTITY,
    })
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(extDir, name), content, 'utf8')
    }

    const base: ModelEntry[] = [{ id: 'claude-sonnet-4', provider: 'anthropic' }]
    const availableWithAuth = augmentModelsWithGoogleAiPlan(base, 'available', agentDir)
    expect(availableWithAuth.filter((m) => m.provider === 'google-ai-plan')).toHaveLength(4)

    // Already present -> no duplicates
    const deduped = augmentModelsWithGoogleAiPlan(availableWithAuth, 'settings', agentDir)
    expect(deduped.filter((m) => m.provider === 'google-ai-plan')).toHaveLength(4)

    // Delete auth -> omitted from `available`, still listed as unconfigured in `settings`
    expect(deleteGoogleAiPlanAuth(agentDir)).toBe(true)
    expect(augmentModelsWithGoogleAiPlan(base, 'available', agentDir).filter((m) => m.provider === 'google-ai-plan')).toHaveLength(0)
    const settingsUnauth = augmentModelsWithGoogleAiPlan(base, 'settings', agentDir).filter(
      (m) => m.provider === 'google-ai-plan',
    )
    expect(settingsUnauth).toHaveLength(4)
    expect(settingsUnauth[0].auth?.configured).toBe(false)
  })

  it('auto-removes obsolete preview extension when active SDK natively includes google-ai-plan while preserving auth.json', async () => {
    const {
      cleanupObsoleteGoogleAiPlanExtension,
      detectSdkBuiltinGoogleAiPlan,
      readBuiltinSdkClientCredentials,
      readGoogleAiPlanAuth,
      writeGoogleAiPlanAuth,
    } = await import('../service')

    const agentDir = makeTempDir()
    const fakeSdkParent = makeTempDir()
    const fakeSdkRoot = join(fakeSdkParent, 'pi-coding-agent')
    const fakePiAiProviders = join(fakeSdkParent, 'pi-ai', 'dist', 'providers')
    const fakeCoreDir = join(fakeSdkRoot, 'dist', 'core')
    mkdirSync(fakePiAiProviders, { recursive: true })
    mkdirSync(fakeCoreDir, { recursive: true })

    // Before SDK upgrade: no google-ai-plan in SDK
    expect(detectSdkBuiltinGoogleAiPlan(agentDir, fakeSdkRoot)).toBe(false)

    // Install preview extension + save OAuth auth
    const extDir = join(agentDir, 'extensions', 'google-ai-plan')
    mkdirSync(extDir, { recursive: true })
    const { files } = buildExtensionFiles({
      repo: 'earendil-works/pi',
      ref: 'google-ai-plan',
      sha: 'abcdef1234567',
      interactionsErrorsTs: SAMPLE_INTERACTIONS_ERRORS,
      interactionsTs: SAMPLE_INTERACTIONS,
      oauthTs: SAMPLE_OAUTH,
      catalogTs: SAMPLE_CATALOG,
      clientIdentityTs: SAMPLE_CLIENT_IDENTITY,
    })
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(extDir, name), content, 'utf8')
    }
    writeGoogleAiPlanAuth(agentDir, {
      type: 'oauth',
      access: 'keep-access',
      refresh: 'keep-refresh',
      expires: 9999999999999,
      dpopKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' },
    })

    // Still not built-in -> must NOT remove
    expect(cleanupObsoleteGoogleAiPlanExtension({ agentDir, sdkRootOverride: fakeSdkRoot })).toEqual({
      removed: false,
      builtinInSdk: false,
    })
    expect(readInstalledGoogleAiPlanExtension(agentDir).installed).toBe(true)

    // Simulate SDK upgrade that includes built-in google-ai-plan + client-identity.js
    writeFileSync(join(fakePiAiProviders, 'google-ai-plan.js'), 'export const googleAiPlanProvider = {};\n', 'utf8')
    writeFileSync(join(fakeCoreDir, 'client-identity.js'), SAMPLE_CLIENT_IDENTITY, 'utf8')

    expect(detectSdkBuiltinGoogleAiPlan(agentDir, fakeSdkRoot)).toBe(true)
    expect(readBuiltinSdkClientCredentials(agentDir, fakeSdkRoot)).toEqual({
      clientId: '1234567890-testclient.apps.googleusercontent.com',
      clientSecret: 'TEST_SECRET_VALUE_NOT_REAL',
    })

    // Auto-cleanup deletes obsolete preview extension AND keeps auth.json intact!
    expect(cleanupObsoleteGoogleAiPlanExtension({ agentDir, sdkRootOverride: fakeSdkRoot })).toEqual({
      removed: true,
      builtinInSdk: true,
    })
    expect(readInstalledGoogleAiPlanExtension(agentDir).installed).toBe(false)
    expect(readGoogleAiPlanAuth(agentDir).signedIn).toBe(true)

    // Safety check: an unrelated custom extension without google-ai-plan markers is NOT deleted
    mkdirSync(extDir, { recursive: true })
    writeFileSync(join(extDir, 'index.ts'), 'export default function customExt() { /* unrelated */ }\n', 'utf8')
    expect(cleanupObsoleteGoogleAiPlanExtension({ agentDir, sdkRootOverride: fakeSdkRoot })).toEqual({
      removed: false,
      builtinInSdk: true,
    })
    expect(readInstalledGoogleAiPlanExtension(agentDir).installed).toBe(true)
  })
})
