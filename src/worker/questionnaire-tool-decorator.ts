import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  Extension,
  LoadExtensionsResult,
  RegisteredTool,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { AdapterJson } from '../extension-compat/adapter-schema.js'
import { resolveV2ByPluginName } from '../extension-compat/adapter-loader.js'
import {
  getDesktopUIBridge,
  type DesktopUIBridge,
  type ExtensionUIQuestion,
} from './desktop-ui-bridge.js'
import { createQuestionnaireRpcUI } from './questionnaire-rpc-ui.js'

function matchedAdapterTool(
  extension: Extension,
  cwd: string,
): { adapter: AdapterJson; toolName: string } | null {
  const candidates = [extension.sourceInfo?.source, extension.path, extension.resolvedPath].filter(
    (candidate): candidate is string => !!candidate,
  )
  for (const candidate of candidates) {
    const adapter = resolveV2ByPluginName(candidate, candidate, cwd)
    const interact = adapter?.interact
    const toolName = interact?.trigger?.tool
    if (adapter && interact?.schema === 'questions' && toolName && extension.tools.has(toolName)) {
      return { adapter, toolName }
    }
  }
  return null
}

function expandHome(filePath: string): string {
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(2))
  }
  return filePath
}

async function resolveFallbackTimeoutMs(
  adapter: AdapterJson,
  extensionPath: string | undefined,
): Promise<number | undefined> {
  const cfgFile = adapter.config?.configFile
  if (cfgFile) {
    try {
      const raw = await fs.readFile(expandHome(cfgFile), 'utf8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const sec = parsed.desktopTimeoutSeconds ?? parsed.timeoutSeconds
      if (typeof sec === 'number' && Number.isFinite(sec) && sec > 0) {
        return Math.round(sec * 1000)
      }
      if (sec === 0) return undefined
    } catch {
      // Optional config file may not exist yet — fall through to adapter defaults.
    }
  }
  const defaultSec = adapter.interact?.defaults?.timeoutSeconds
  if (typeof defaultSec === 'number' && Number.isFinite(defaultSec) && defaultSec > 0) {
    return Math.round(defaultSec * 1000)
  }
  if (extensionPath && /nicknisi[\\/]pi-ask-user-question/i.test(extensionPath)) {
    return 300_000
  }
  return undefined
}

function normalizeQuestions(params: unknown): ExtensionUIQuestion[] {
  const rawList = (params as { questions?: unknown })?.questions
  if (!Array.isArray(rawList)) return []
  return rawList.map((entry) => {
    const q = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const description =
      typeof q.description === 'string'
        ? q.description
        : typeof q.hint === 'string'
          ? q.hint
          : undefined
    return {
      question: typeof q.question === 'string' ? q.question : '',
      header: typeof q.header === 'string' ? q.header : undefined,
      description,
      multiSelect: Boolean(q.multiSelect),
      recommended: typeof q.recommended === 'string' ? q.recommended : undefined,
      recommendedBecause: typeof q.recommendedBecause === 'string' ? q.recommendedBecause : undefined,
      options: Array.isArray(q.options) ? (q.options as ExtensionUIQuestion['options']) : [],
    }
  })
}

function decorateTool(
  registered: RegisteredTool,
  adapter: AdapterJson,
  extensionPath: string | undefined,
  resolveFallbackBridge?: () => DesktopUIBridge | null,
): RegisteredTool {
  const definition = registered.definition as ToolDefinition
  const execute = definition.execute.bind(definition)
  return {
    ...registered,
    definition: {
      ...definition,
      executionMode: 'sequential',
      async execute(toolCallId, params, signal, onUpdate, context) {
        const bridge = getDesktopUIBridge(context.ui) ?? resolveFallbackBridge?.() ?? null
        if (!bridge) return execute(toolCallId, params, signal, onUpdate, context)
        const questions = normalizeQuestions(params)
        const ui = createQuestionnaireRpcUI(
          context.ui,
          toolCallId,
          questions,
          signal,
          async (id, rows, abortSignal, timeoutMs) => {
            const effectiveTimeout =
              timeoutMs ?? (await resolveFallbackTimeoutMs(adapter, extensionPath))
            return bridge.requestQuestionnaire(id, rows, abortSignal, effectiveTimeout)
          },
        )
        return execute(toolCallId, params, signal, onUpdate, {
          ...context,
          ui,
        } as typeof context)
      },
    },
  }
}

export function decorateQuestionnaireTools(
  result: LoadExtensionsResult,
  cwd: string,
  resolveFallbackBridge?: () => DesktopUIBridge | null,
): LoadExtensionsResult {
  return {
    ...result,
    extensions: result.extensions.map((extension) => {
      const hit = matchedAdapterTool(extension, cwd)
      if (!hit) return extension
      const registered = extension.tools.get(hit.toolName)
      if (!registered) return extension
      const tools = new Map(extension.tools)
      tools.set(
        hit.toolName,
        decorateTool(
          registered,
          hit.adapter,
          extension.resolvedPath || extension.path,
          resolveFallbackBridge,
        ),
      )
      return { ...extension, tools }
    }),
  }
}
