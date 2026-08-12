import type {
  Extension,
  ExtensionContext,
  LoadExtensionsResult,
  RegisteredTool,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { resolveV2ByPluginName } from '../extension-compat/adapter-loader.js'
import {
  getDesktopUIBridge,
  type ExtensionUIQuestion,
} from './desktop-ui-bridge.js'
import { createQuestionnaireRpcUI } from './questionnaire-rpc-ui.js'

function matchedToolName(extension: Extension, cwd: string): string | null {
  const candidates = [extension.sourceInfo?.source, extension.path, extension.resolvedPath].filter(
    (candidate): candidate is string => !!candidate,
  )
  for (const candidate of candidates) {
    const adapter = resolveV2ByPluginName(candidate, candidate, cwd)
    const interact = adapter?.interact
    const toolName = interact?.trigger?.tool
    if (interact?.schema === 'questions' && toolName && extension.tools.has(toolName)) {
      return toolName
    }
  }
  return null
}

function decorateTool(registered: RegisteredTool): RegisteredTool {
  const definition = registered.definition as ToolDefinition
  const execute = definition.execute.bind(definition)
  return {
    ...registered,
    definition: {
      ...definition,
      executionMode: 'sequential',
      async execute(toolCallId, params, signal, onUpdate, context) {
        const bridge = getDesktopUIBridge(context.ui)
        if (!bridge) return execute(toolCallId, params, signal, onUpdate, context)
        const questions = (params as { questions?: ExtensionUIQuestion[] }).questions || []
        const ui = createQuestionnaireRpcUI(
          context.ui,
          toolCallId,
          questions,
          signal,
          (id, rows, abortSignal) => bridge.requestQuestionnaire(id, rows, abortSignal),
        )
        return execute(toolCallId, params, signal, onUpdate, {
          ...context,
          ui,
        } as ExtensionContext)
      },
    },
  }
}

export function decorateQuestionnaireTools(
  result: LoadExtensionsResult,
  cwd: string,
): LoadExtensionsResult {
  return {
    ...result,
    extensions: result.extensions.map((extension) => {
      const toolName = matchedToolName(extension, cwd)
      if (!toolName) return extension
      const registered = extension.tools.get(toolName)
      if (!registered) return extension
      const tools = new Map(extension.tools)
      tools.set(toolName, decorateTool(registered))
      return { ...extension, tools }
    }),
  }
}
