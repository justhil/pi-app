// Contained registry of specialized config renderers for plugins whose config is dynamic
// (not expressible as static adapter.json sections). Keyed by adapter.json config.customRenderer.
// This is the ONLY place plugin-specific config components live; everything else is generic AdapterConfigPanel.
import type { ComponentType } from 'react'
import { SkillsManagerConfig } from './skills-manager-config'
import { McpDiagnostics } from './mcp-diagnostics'

export interface CustomRendererProps {
  extensionId: string
  workspace: string
  onChange: (next: Record<string, unknown>) => void
}

export const CUSTOM_CONFIG_RENDERERS: Record<string, ComponentType<CustomRendererProps>> = {
  'skills-manager': SkillsManagerConfig,
  'mcp-diagnostics': McpDiagnostics,
}
