import type { AdapterJson, ToolCardTemplate } from '@extension-compat/adapter-schema'
import { currentAdapterCatalog, invalidateAdapterSnapshots, useAdapterCatalog } from '@renderer/lib/adapter-catalog'

export function invalidateToolCardCatalog(): void {
  invalidateAdapterSnapshots()
}

export function resolveAdapterForTool(toolName: string): AdapterJson | undefined {
  return currentAdapterCatalog().find((adapter) => adapter.match.tools?.includes(toolName))
}

export function resolveToolCardTemplate(toolName: string | undefined): ToolCardTemplate | undefined {
  return resolveToolCardDef(toolName)?.template
}

export function resolveToolCardDef(toolName: string | undefined): AdapterJson['toolCard'] | undefined {
  return toolName ? resolveAdapterForTool(toolName)?.toolCard : undefined
}

export function resolveAdapterToolCardTemplate(toolName: string | undefined): string | undefined {
  return resolveToolCardDef(toolName)?.template
}

export function useToolCardCatalogReady(): boolean {
  return !!useAdapterCatalog()
}
