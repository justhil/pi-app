import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export const UPSTREAM_PR_REPO = 'earendil-works/pi'
export const UPSTREAM_PR_NUMBER = 12614
export const UPSTREAM_FALLBACK_REF = 'google-ai-plan'
export const UPSTREAM_PR_URL = `https://github.com/${UPSTREAM_PR_REPO}/pull/${UPSTREAM_PR_NUMBER}`
export const GOOGLE_AI_PLAN_PROVIDER_ID = 'google-ai-plan'
export const GOOGLE_AI_PLAN_EXTENSION_DIR = 'google-ai-plan'
export const GOOGLE_AI_PLAN_META_FILE = '.upstream-pr.json'
export const COMPAT_EXTENSION_VERSION = 1

export interface GoogleAiPlanClientConfig {
  clientId: string
  clientSecret: string
}

export interface GoogleAiPlanThinkingLevelMap {
  off: string | null
  minimal: string | null
  low: string | null
  medium: string | null
  high: string | null
  xhigh: string | null
  max: string | null
}

export interface GoogleAiPlanModelDef {
  id: string
  name: string
  thinkingLevelMap: GoogleAiPlanThinkingLevelMap
  contextWindow?: number
  maxTokens?: number
}

export interface GoogleAiPlanExtensionMeta {
  pr: number
  repo: string
  ref: string
  sha: string
  prState?: string
  prMerged?: boolean
  fetchedAt: number
  compatVersion: number
  models: GoogleAiPlanModelDef[]
}

export interface InstalledGoogleAiPlanExtension {
  installed: boolean
  dir: string
  entryPath: string
  managedByApp: boolean
  meta: GoogleAiPlanExtensionMeta | null
  client: GoogleAiPlanClientConfig | null
  models: GoogleAiPlanModelDef[]
}

const DEFAULT_THINKING_XHIGH: GoogleAiPlanThinkingLevelMap = {
  off: null,
  minimal: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: null,
}

const DEFAULT_THINKING_HIGH: GoogleAiPlanThinkingLevelMap = {
  off: null,
  minimal: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: null,
  max: null,
}

const DEFAULT_THINKING_FLASH_LITE: GoogleAiPlanThinkingLevelMap = {
  off: null,
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: null,
  max: null,
}

const FALLBACK_MODELS: GoogleAiPlanModelDef[] = [
  { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen', thinkingLevelMap: DEFAULT_THINKING_XHIGH },
  { id: 'gemini-4-neon', name: 'Gemini 4 Neon', thinkingLevelMap: DEFAULT_THINKING_XHIGH },
  { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', thinkingLevelMap: DEFAULT_THINKING_HIGH },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', thinkingLevelMap: DEFAULT_THINKING_FLASH_LITE },
]

export function getGoogleAiPlanExtensionDir(agentDir: string): string {
  return join(agentDir, 'extensions', GOOGLE_AI_PLAN_EXTENSION_DIR)
}

export function extractClientCredentialsFromSource(source: string): GoogleAiPlanClientConfig {
  const blockMatch = source.match(/PI_GOOGLE_AI_PLAN_CLIENT[\s\S]*?=\s*\{([\s\S]*?)\}/)
  const searchArea = blockMatch ? blockMatch[1] : source
  const idMatch = searchArea.match(/["']?clientId["']?\s*:\s*["']([^"']+)["']/)
  const secretMatch = searchArea.match(/["']?clientSecret["']?\s*:\s*["']([^"']+)["']/)
  if (!idMatch?.[1] || !secretMatch?.[1]) {
    throw new Error('Failed to parse PI_GOOGLE_AI_PLAN_CLIENT from upstream client-identity.ts')
  }
  return {
    clientId: idMatch[1].trim(),
    clientSecret: secretMatch[1].trim(),
  }
}

function parseThinkingMapBody(body: string): GoogleAiPlanThinkingLevelMap {
  const readVal = (key: keyof GoogleAiPlanThinkingLevelMap): string | null => {
    const m = body.match(new RegExp(`["']?\\b${key}\\b["']?\\s*:\\s*(null|["'][^"']+["'])`))
    if (!m || m[1] === 'null') return null
    return m[1].slice(1, -1)
  }
  return {
    off: readVal('off'),
    minimal: readVal('minimal'),
    low: readVal('low'),
    medium: readVal('medium'),
    high: readVal('high'),
    xhigh: readVal('xhigh'),
    max: readVal('max'),
  }
}

export function extractCatalogModelsFromSource(source: string): GoogleAiPlanModelDef[] {
  const namedMaps = new Map<string, GoogleAiPlanThinkingLevelMap>()
  const mapDeclRe = /const\s+([A-Za-z0-9_]+)\s*(?::\s*ThinkingLevelMap)?\s*=\s*\{([\s\S]*?)\};/g
  for (const m of source.matchAll(mapDeclRe)) {
    const body = m[2]
    if (/["']?\blow\b["']?\s*:/.test(body) && /["']?\bhigh\b["']?\s*:/.test(body)) {
      namedMaps.set(m[1], parseThinkingMapBody(body))
    }
  }

  const modelsBlockMatch = source.match(/const\s+(?:MODELS|MODEL_DEFS)[\s\S]*?=\s*\[([\s\S]*?)\];/)
  if (!modelsBlockMatch) {
    throw new Error('Failed to parse MODELS list from upstream google-ai-plan catalog')
  }

  const models: GoogleAiPlanModelDef[] = []
  const itemRe = /\{\s*["']?id["']?\s*:\s*["']([^"']+)["']\s*,\s*["']?name["']?\s*:\s*["']([^"']+)["']\s*,\s*["']?thinkingLevelMap["']?\s*:\s*([A-Za-z0-9_]+|\{[\s\S]*?\})\s*(?:,[\s\S]*?)?\}/g
  for (const m of modelsBlockMatch[1].matchAll(itemRe)) {
    const id = m[1].trim()
    const name = m[2].trim()
    const rawMap = m[3].trim()
    const thinkingLevelMap = rawMap.startsWith('{')
      ? parseThinkingMapBody(rawMap)
      : (namedMaps.get(rawMap) ?? DEFAULT_THINKING_HIGH)
    models.push({ id, name, thinkingLevelMap, contextWindow: 1048576, maxTokens: 65536 })
  }

  if (models.length === 0) {
    throw new Error('Upstream google-ai-plan catalog contained no recognizable models')
  }
  return models
}

/**
 * Rewrite upstream `packages/ai/src/api/google-interactions.ts` so every internal
 * `pi-ai` import resolves through `./compat-helpers.ts`, making it work cleanly on
 * both bundled `@earendil-works/pi-ai@1.0.2` and newer `1.6.x+` releases.
 */
export function transformGoogleInteractionsSource(source: string): string {
  let out = source
  // Drop `@google/genai` type-only import; older @google/genai versions lack `Interactions` types.
  out = out.replace(/import\s+type\s+\{\s*Interactions\s*\}\s+from\s+["']@google\/genai["'];?\r?\n?/g, '')
  // Keep `google-interactions-errors.ts` relative; redirect all other relative imports to compat-helpers.ts.
  out = out.replace(
    /from\s+["'](\.\.\/[^"']+|\.\/(?!google-interactions-errors(?:\.ts|\.js)?["'])[^"']+)["']/g,
    'from "./compat-helpers.ts"',
  )
  // Avoid TypeScript strict issues if checked outside pi-ai monorepo.
  out = out.replace(/type\s+Step\s*=\s*Interactions\.Step;/g, 'type Step = any;')
  out = out.replace(/type\s+SseEvent\s*=\s*Interactions\.InteractionSSEEvent;/g, 'type SseEvent = any;')
  out = out.replace(/Interactions\.[A-Za-z0-9_.\[\]"']+/g, 'any')
  out = out.replace(/Model<"google-interactions">/g, 'Model<any>')
  out = out.replace(/StreamFunction<"google-interactions",\s*/g, 'StreamFunction<any, ')
  return out
}

export function transformGoogleOAuthSource(source: string): string {
  let out = source
  out = out.replace(/from\s+["']\.\.\/types(?:\.ts|\.js)?["']/g, 'from "@earendil-works/pi-ai"')
  out = out.replace(/from\s+["']\.\/(?:callback-server|pkce)(?:\.ts|\.js)?["']/g, 'from "./oauth-helpers.ts"')
  return out
}

// Construct generated `import ... from "..."` lines dynamically so electron-vite's
// esmShimPlugin regex never mistakes template strings for top-level bundle imports.
function esmImport(clause: string, specifier: string): string {
  return `${['im', 'port'].join('')} ${clause} from "${specifier}";`
}

function buildCompatHelpersSource(): string {
  return `/**
 * Self-contained compatibility helpers so the upstream PR #12614 google-interactions
 * module runs on both bundled @earendil-works/pi-ai@1.0.2 and newer 1.6.x+ runtimes
 * without relying on internal node_modules subpaths.
 */
${esmImport('* as piAi', '@earendil-works/pi-ai')}
${esmImport(`{
  AssistantMessageEventStream,
  calculateCost,
  clampThinkingLevel,
  collapseSystemMessages,
  getCurrentTools,
  getInitialSystemMessage,
  getSystemMessageText,
  parseJsonWithRepair,
  parseStreamingJson,
  withoutInitialSystemMessage,
}`, '@earendil-works/pi-ai')}

export {
  AssistantMessageEventStream,
  calculateCost,
  clampThinkingLevel,
  collapseSystemMessages,
  getCurrentTools,
  getInitialSystemMessage,
  getSystemMessageText,
  withoutInitialSystemMessage,
};

export type {
  AssistantMessage,
  AssistantMessageEvent,
  ImageContent,
  Model,
  SimpleStreamOptions,
  StopReason,
  StreamFunction,
  StreamOptions,
  TextContent,
  TranscriptContext,
} from "@earendil-works/pi-ai";

export type ResolvedGoogleThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";

export function resolveGoogleThinkingLevel(model: any, level: string): ResolvedGoogleThinkingLevel {
  const mapped = model?.thinkingLevelMap?.[level];
  const resolved = typeof mapped === "string" ? mapped.toLowerCase() : String(level).toLowerCase();
  if (
    resolved === "minimal" ||
    resolved === "low" ||
    resolved === "medium" ||
    resolved === "high" ||
    resolved === "xhigh"
  ) {
    return resolved;
  }
  throw new Error(
    \`Unsupported Google thinking level mapping for \${model?.provider}/\${model?.id}: \${level} -> \${String(mapped)}\`,
  );
}

export function buildBaseOptions(model: any, _context: any, options?: any): Record<string, any> {
  const maxTokens = options?.maxTokens ?? Math.min(model?.maxTokens || 32000, 32000);
  return {
    ...(options ?? {}),
    maxTokens,
  };
}

export function getJsonSchemaToolParameters(tool: any, _strict: boolean): unknown {
  return tool?.parameters ?? { type: "object", properties: {} };
}

export function sanitizeSurrogates(text: string): string {
  if (!text) return "";
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i++;
      } else {
        out += "\\uFFFD";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += "\\uFFFD";
    } else {
      out += text[i];
    }
  }
  return out;
}

export function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function providerHeadersToRecord(...sources: Array<Record<string, string> | Headers | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  const keyMap = new Map<string, string>();
  for (const src of sources) {
    if (!src) continue;
    const entries: Array<[string, string]> =
      src instanceof Headers ? Array.from(src.entries()) : Object.entries(src);
    for (const [k, v] of entries) {
      if (v === undefined || v === null) continue;
      const lower = k.toLowerCase();
      const prevKey = keyMap.get(lower);
      if (prevKey && prevKey !== k) delete out[prevKey];
      keyMap.set(lower, k);
      out[k] = String(v);
    }
  }
  return out;
}

export function getIdentityHeaders(model: any, identity?: any): Record<string, string> {
  const nativeFn = (piAi as Record<string, unknown>).getIdentityHeaders;
  if (typeof nativeFn === "function") {
    try {
      return (nativeFn as (m: any, id?: any) => Record<string, string>)(model, identity) ?? {};
    } catch {
      /* fall through to compat header */
    }
  }
  const userAgent =
    typeof identity?.userAgent === "string" && identity.userAgent.trim()
      ? identity.userAgent.trim()
      : "pi-desktop";
  return { "user-agent": userAgent };
}

export class ToolCallArgumentsStream {
  text = "";

  append(delta: string): Record<string, unknown> {
    this.text += delta;
    const parsed = parseStreamingJson(this.text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  }
}

export function parseToolCallArguments(raw?: string): { arguments: Record<string, unknown> } {
  const nativeFn = (piAi as Record<string, unknown>).parseToolCallArguments;
  if (typeof nativeFn === "function") {
    return (nativeFn as (r?: string) => { arguments: Record<string, unknown> })(raw);
  }
  const text = (raw ?? "").trim();
  if (!text) return { arguments: {} };
  try {
    const parsed = parseJsonWithRepair(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { arguments: parsed as Record<string, unknown> };
    }
  } catch {
    /* fallback below */
  }
  const partial = parseStreamingJson(text);
  return {
    arguments:
      partial && typeof partial === "object" && !Array.isArray(partial)
        ? (partial as Record<string, unknown>)
        : {},
  };
}

export class SseDecoder {
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private dataLines: string[] = [];

  push(chunk: Uint8Array): Array<{ data?: string }> {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  end(): Array<{ data?: string }> {
    this.buffer += this.decoder.decode();
    const events = this.drain(true);
    if (this.dataLines.length > 0) {
      events.push({ data: this.dataLines.join("\\n") });
      this.dataLines = [];
    }
    return events;
  }

  private drain(flushTail: boolean): Array<{ data?: string }> {
    const events: Array<{ data?: string }> = [];
    const normalized = this.buffer.replace(/\\r\\n/g, "\\n").replace(/\\r/g, "\\n");
    const lines = normalized.split("\\n");
    this.buffer = flushTail ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (line === "") {
        if (this.dataLines.length > 0) {
          events.push({ data: this.dataLines.join("\\n") });
          this.dataLines = [];
        }
        continue;
      }
      if (line.startsWith(":")) continue;
      if (line.startsWith("data:")) {
        const value = line.slice(5);
        this.dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
      }
    }
    return events;
  }
}

export function transformMessages(messages: any[], model: any): any[] {
  const transformed: any[] = [];
  for (const msg of messages) {
    if (!msg) continue;
    if (msg.role === "assistant" && (msg.stopReason === "error" || msg.stopReason === "aborted")) {
      continue;
    }
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const sameModel = msg.provider === model?.provider && msg.model === model?.id;
      const content = msg.content.map((block: any) => {
        if (block?.type === "thinking" && !sameModel) {
          return { ...block, thinkingSignature: undefined };
        }
        return block;
      });
      transformed.push({ ...msg, content });
      continue;
    }
    transformed.push(msg);
  }

  // Ensure every assistant toolCall has a matching toolResult before the next user/assistant turn.
  const result: any[] = [];
  let pendingToolCalls: any[] = [];
  const resolvedToolIds = new Set<string>();
  const flushOrphans = () => {
    for (const tc of pendingToolCalls) {
      if (!resolvedToolIds.has(tc.id)) {
        result.push({
          role: "toolResult",
          toolCallId: tc.id,
          toolName: tc.name,
          content: [{ type: "text", text: "No result provided" }],
          isError: true,
          timestamp: Date.now(),
        });
      }
    }
    pendingToolCalls = [];
    resolvedToolIds.clear();
  };

  for (const msg of transformed) {
    if (msg.role === "assistant") {
      flushOrphans();
      result.push(msg);
      if (Array.isArray(msg.content)) {
        pendingToolCalls = msg.content.filter((b: any) => b?.type === "toolCall");
      }
    } else if (msg.role === "toolResult") {
      if (msg.toolCallId) resolvedToolIds.add(msg.toolCallId);
      result.push(msg);
    } else {
      flushOrphans();
      result.push(msg);
    }
  }
  return result;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status <= 599);
}

function parseRetryDelayMs(headers: Headers | undefined, attempt: number, maxRetryDelayMs: number): number {
  const retryAfter = headers?.get("retry-after");
  if (retryAfter) {
    const sec = Number(retryAfter);
    if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, maxRetryDelayMs);
    const ts = Date.parse(retryAfter);
    if (!Number.isNaN(ts) && ts > Date.now()) return Math.min(ts - Date.now(), maxRetryDelayMs);
  }
  const base = Math.min(1000 * 2 ** attempt, maxRetryDelayMs);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Request was aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Request was aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function retryProviderRequest<T>(
  request: () => Promise<T>,
  options?: { maxRetries?: number; maxRetryDelayMs?: number; signal?: AbortSignal },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 2;
  const maxRetryDelayMs = options?.maxRetryDelayMs ?? 30_000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (options?.signal?.aborted || attempt >= maxRetries) throw error;
      const errObj = error as { status?: unknown; headers?: Headers; name?: string };
      const status = typeof errObj?.status === "number" ? errObj.status : undefined;
      const isNetworkErr = status === undefined && errObj?.name === "TypeError";
      if (status !== undefined && !isRetryableStatus(status)) throw error;
      if (status === undefined && !isNetworkErr) throw error;
      const delayMs = parseRetryDelayMs(errObj?.headers, attempt, maxRetryDelayMs);
      await sleepWithSignal(delayMs, options?.signal);
    }
  }
  throw lastError;
}

export function normalizeProviderError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function formatProviderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
`
}

function buildOAuthHelpersSource(): string {
  return `${esmImport('{ createServer }', 'node:http')}
${esmImport('type { ProviderAuthInteraction }', '@earendil-works/pi-ai')}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function oauthSuccessHtml(message: string): string {
  return \`<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:2rem"><h2>Sign-in complete</h2><p>\${escapeHtml(message)}</p></body></html>\`;
}

function oauthErrorHtml(title: string, detail?: string): string {
  return \`<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:2rem"><h2>\${escapeHtml(title)}</h2>\${detail ? \`<p>\${escapeHtml(detail)}</p>\` : ""}</body></html>\`;
}

function base64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64urlEncode(verifierBytes);
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64urlEncode(new Uint8Array(hashBuffer));
  return { verifier, challenge };
}

export interface OAuthCallbackServerOptions<T> {
  providerName: string;
  host: string;
  port: number;
  path: string;
  redirectHost?: string;
  state?: string;
  complete: (code: string) => Promise<T>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface OAuthCallbackServer<T> {
  redirectUri: string;
  wait(): Promise<T | undefined>;
  cancel(): void;
  close(): void;
}

function sendPage(response: any, status: number, html: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(html);
}

export async function startOAuthCallbackServer<T>(
  options: OAuthCallbackServerOptions<T>,
): Promise<OAuthCallbackServer<T>> {
  const { providerName, signal } = options;
  if (signal?.aborted) throw new Error("Login cancelled");

  let resolveWait: (v: T | undefined) => void = () => {};
  let rejectWait: (e: unknown) => void = () => {};
  const waitPromise = new Promise<T | undefined>((resolve, reject) => {
    resolveWait = resolve;
    rejectWait = reject;
  });
  waitPromise.catch(() => undefined);

  let claimed = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onAbort = () => finish({ error: new Error("Login cancelled") });
  const finish = (result: { value: T | undefined } | { error: unknown }) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    if ("error" in result) rejectWait(result.error);
    else resolveWait(result.value);
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method !== "GET" || url.pathname !== options.path) {
        sendPage(response, 404, oauthErrorHtml("Callback route not found."));
        return;
      }
      if (options.state !== undefined && url.searchParams.get("state") !== options.state) {
        sendPage(response, 400, oauthErrorHtml("State mismatch."));
        return;
      }
      if (claimed || settled) {
        sendPage(response, 409, oauthErrorHtml("This sign-in has already been handled."));
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        const description = url.searchParams.get("error_description") ?? error;
        sendPage(response, 400, oauthErrorHtml(\`\${providerName} authorization failed.\`, description));
        finish({ error: new Error(\`\${providerName} authorization failed: \${description}\`) });
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        sendPage(response, 400, oauthErrorHtml("Missing authorization code."));
        return;
      }
      claimed = true;
      try {
        const value = await options.complete(code);
        sendPage(response, 200, oauthSuccessHtml(\`Signed in to \${providerName}. You may now close this page.\`));
        finish({ value });
      } catch (err) {
        const failure = err instanceof Error ? err : new Error(String(err));
        sendPage(response, 502, oauthErrorHtml(\`\${providerName} sign-in failed.\`, failure.message));
        finish({ error: failure });
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("OAuth callback server did not bind to TCP");
  }

  server.on("error", (error) => finish({ error }));
  signal?.addEventListener("abort", onAbort, { once: true });
  if (options.timeoutMs !== undefined) {
    timer = setTimeout(() => finish({ error: new Error(\`\${providerName} sign-in timed out\`) }), options.timeoutMs);
  }

  const redirectHost = options.redirectHost ?? options.host;
  return {
    redirectUri: \`http://\${redirectHost.includes(":") ? \`[\${redirectHost}]\` : redirectHost}:\${address.port}\${options.path}\`,
    wait: () => waitPromise,
    cancel: () => {
      if (!claimed) finish({ value: undefined });
    },
    close: () => {
      finish({ error: new Error("OAuth callback server closed") });
      server.close();
    },
  };
}

export async function waitForCallbackOrManualInput<T>(
  interaction: ProviderAuthInteraction,
  callback: OAuthCallbackServer<T> | undefined,
  prompt: { message: string; placeholder: string },
): Promise<{ type: "callback"; value: T } | { type: "manual"; input: string }> {
  const manualAbort = new AbortController();
  let manualError: Error | undefined;
  const manual = interaction
    .prompt({ type: "manual_code", ...prompt, signal: manualAbort.signal })
    .then((input) => {
      callback?.cancel();
      return input;
    })
    .catch((err) => {
      manualError = err instanceof Error ? err : new Error(String(err));
      callback?.cancel();
      return undefined;
    });

  try {
    const value = await callback?.wait();
    if (manualError) throw manualError;
    if (value !== undefined) return { type: "callback", value };
    const input = await manual;
    if (manualError) throw manualError;
    return { type: "manual", input: input ?? "" };
  } finally {
    manualAbort.abort();
  }
}
`
}

function buildExtensionIndexSource(
  client: GoogleAiPlanClientConfig,
  models: GoogleAiPlanModelDef[],
  meta: GoogleAiPlanExtensionMeta,
): string {
  const clientJson = JSON.stringify(client, null, 2)
  const modelsJson = JSON.stringify(models, null, 2)
  return `/**
 * Non-intrusive local extension synced from ${UPSTREAM_PR_REPO}#${meta.pr} (${meta.sha.slice(0, 10)}).
 * Exposes Google AI Ultra plan (\`${GOOGLE_AI_PLAN_PROVIDER_ID}\`) without patching the installed Pi SDK.
 * Remove this directory once upstream merges PR #${meta.pr} into your active Pi SDK release.
 */
${esmImport('type { ExtensionAPI }', '@earendil-works/pi-coding-agent')}
${esmImport('{ createProvider, type Model }', '@earendil-works/pi-ai')}
${esmImport('{ stream, streamSimple }', './google-interactions.ts')}
${esmImport('{ createGoogleAiPlanOAuth, type GoogleAiPlanClient }', './oauth.ts')}

export const PI_GOOGLE_AI_PLAN_CLIENT: GoogleAiPlanClient = ${clientJson};

export const MODEL_DEFS = ${modelsJson};

export default function googleAiPlanExtension(pi: ExtensionAPI): void {
  const models: Model<any>[] = MODEL_DEFS.map(({ id, name, thinkingLevelMap, contextWindow, maxTokens }) => ({
    id,
    name,
    api: "google-interactions",
    provider: "${GOOGLE_AI_PLAN_PROVIDER_ID}",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    reasoning: true,
    thinkingLevelMap,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: contextWindow ?? 1048576,
    maxTokens: maxTokens ?? 65536,
    maxRequestBytes: 100 * 1024 * 1024,
    inputLimits: { maxRequestBytes: 100 * 1024 * 1024, images: { maxPerRequest: 3600 } },
  }));

  const provider = createProvider({
    id: "${GOOGLE_AI_PLAN_PROVIDER_ID}",
    name: "Google AI Ultra plan",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    auth: {
      oauth: createGoogleAiPlanOAuth(PI_GOOGLE_AI_PLAN_CLIENT),
    },
    models,
    api: {
      stream,
      streamSimple,
    } as any,
  });

  pi.registerProvider(provider as any);
}
`
}

export interface UpstreamPrSources {
  repo: string
  ref: string
  sha: string
  prState?: string
  prMerged?: boolean
  interactionsErrorsTs: string
  interactionsTs: string
  oauthTs: string
  catalogTs: string
  clientIdentityTs: string
}

export function buildExtensionFiles(sources: UpstreamPrSources): {
  files: Record<string, string>
  meta: GoogleAiPlanExtensionMeta
  client: GoogleAiPlanClientConfig
} {
  const client = extractClientCredentialsFromSource(sources.clientIdentityTs)
  const models = extractCatalogModelsFromSource(sources.catalogTs)
  const meta: GoogleAiPlanExtensionMeta = {
    pr: UPSTREAM_PR_NUMBER,
    repo: sources.repo,
    ref: sources.ref,
    sha: sources.sha,
    prState: sources.prState,
    prMerged: sources.prMerged,
    fetchedAt: Date.now(),
    compatVersion: COMPAT_EXTENSION_VERSION,
    models,
  }

  return {
    client,
    meta,
    files: {
      'google-interactions-errors.ts': sources.interactionsErrorsTs,
      'google-interactions.ts': transformGoogleInteractionsSource(sources.interactionsTs),
      'oauth.ts': transformGoogleOAuthSource(sources.oauthTs),
      'oauth-helpers.ts': buildOAuthHelpersSource(),
      'compat-helpers.ts': buildCompatHelpersSource(),
      'index.ts': buildExtensionIndexSource(client, models, meta),
      [GOOGLE_AI_PLAN_META_FILE]: `${JSON.stringify(meta, null, 2)}\n`,
    },
  }
}

async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetchImpl(url, {
    headers: {
      Accept: 'text/plain, application/vnd.github+json',
      'User-Agent': 'pi-desktop',
    },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`)
  }
  return res.text()
}

async function resolveUpstreamPrRef(
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<{ repo: string; ref: string; sha: string; prState?: string; prMerged?: boolean }> {
  const apiUrl = `https://api.github.com/repos/${UPSTREAM_PR_REPO}/pulls/${UPSTREAM_PR_NUMBER}`
  try {
    const res = await fetchImpl(apiUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'pi-desktop',
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    })
    if (res.ok) {
      const data = (await res.json()) as {
        state?: string
        merged?: boolean
        head?: { sha?: string; ref?: string; repo?: { full_name?: string } }
      }
      const headSha = data.head?.sha?.trim()
      const headRef = data.head?.ref?.trim()
      const headRepo = data.head?.repo?.full_name?.trim() || UPSTREAM_PR_REPO
      if (headSha) {
        return {
          repo: headRepo,
          ref: headRef || UPSTREAM_FALLBACK_REF,
          sha: headSha,
          prState: data.state,
          prMerged: Boolean(data.merged),
        }
      }
    }
  } catch {
    /* fall back to known branch ref if GitHub API is rate-limited */
  }
  return {
    repo: UPSTREAM_PR_REPO,
    ref: UPSTREAM_FALLBACK_REF,
    sha: UPSTREAM_FALLBACK_REF,
  }
}

export async function fetchAndInstallGoogleAiPlanExtension(
  agentDir: string,
  options?: { fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<{ dir: string; meta: GoogleAiPlanExtensionMeta; client: GoogleAiPlanClientConfig }> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch
  const resolved = await resolveUpstreamPrRef(fetchImpl, options?.signal)
  const rawBase = `https://raw.githubusercontent.com/${resolved.repo}/${resolved.sha}`

  const [interactionsErrorsTs, interactionsTs, oauthTs, catalogTs, clientIdentityTs] = await Promise.all([
    fetchText(fetchImpl, `${rawBase}/packages/ai/src/api/google-interactions-errors.ts`, options?.signal),
    fetchText(fetchImpl, `${rawBase}/packages/ai/src/api/google-interactions.ts`, options?.signal),
    fetchText(fetchImpl, `${rawBase}/packages/ai/src/auth/oauth/google-ai-plan.ts`, options?.signal),
    fetchText(fetchImpl, `${rawBase}/packages/ai/catalog/providers/google-ai-plan.ts`, options?.signal),
    fetchText(fetchImpl, `${rawBase}/packages/coding-agent/src/core/client-identity.ts`, options?.signal),
  ])

  const { files, meta, client } = buildExtensionFiles({
    ...resolved,
    interactionsErrorsTs,
    interactionsTs,
    oauthTs,
    catalogTs,
    clientIdentityTs,
  })

  const extensionsRoot = join(agentDir, 'extensions')
  const targetDir = getGoogleAiPlanExtensionDir(agentDir)
  const stagingDir = join(extensionsRoot, `.${GOOGLE_AI_PLAN_EXTENSION_DIR}.tmp-${process.pid}-${Date.now()}`)

  mkdirSync(stagingDir, { recursive: true })
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(stagingDir, name), content, 'utf8')
    }
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true })
    }
    renameSync(stagingDir, targetDir)
  } catch (err) {
    rmSync(stagingDir, { recursive: true, force: true })
    throw err
  }

  return { dir: targetDir, meta, client }
}

export function readInstalledGoogleAiPlanExtension(agentDir: string): InstalledGoogleAiPlanExtension {
  const dir = getGoogleAiPlanExtensionDir(agentDir)
  const entryPath = join(dir, 'index.ts')
  if (!existsSync(entryPath)) {
    return {
      installed: false,
      dir,
      entryPath,
      managedByApp: false,
      meta: null,
      client: null,
      models: [],
    }
  }

  let meta: GoogleAiPlanExtensionMeta | null = null
  const metaPath = join(dir, GOOGLE_AI_PLAN_META_FILE)
  if (existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as GoogleAiPlanExtensionMeta
      if (parsed && typeof parsed === 'object' && typeof parsed.sha === 'string') {
        meta = parsed
      }
    } catch {
      meta = null
    }
  }

  let indexSource = ''
  try {
    indexSource = readFileSync(entryPath, 'utf8')
  } catch {
    indexSource = ''
  }

  let client: GoogleAiPlanClientConfig | null = null
  try {
    client = extractClientCredentialsFromSource(indexSource)
  } catch {
    client = null
  }

  let models: GoogleAiPlanModelDef[] = []
  if (meta?.models?.length) {
    models = meta.models
  } else {
    try {
      models = extractCatalogModelsFromSource(indexSource)
    } catch {
      models = FALLBACK_MODELS
    }
  }

  return {
    installed: true,
    dir,
    entryPath,
    managedByApp: meta !== null,
    meta,
    client,
    models,
  }
}

export function removeGoogleAiPlanExtensionDir(agentDir: string): boolean {
  const dir = getGoogleAiPlanExtensionDir(agentDir)
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}
