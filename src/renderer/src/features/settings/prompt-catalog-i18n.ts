import type { TFunction } from 'i18next'

export type PromptRowLike = {
  id: string
  category: string
  name: string
  description: string
  path: string | null
  command: string
  source?: string
}

const BUILTIN_ID_KEYS: Record<string, { name: string; description: string }> = {
  'builtin:system:project': {
    name: 'settings:prompts.items.systemProject.name',
    description: 'settings:prompts.items.systemProject.description',
  },
  'builtin:system:default': {
    name: 'settings:prompts.items.systemDefaultPreview.name',
    description: 'settings:prompts.items.systemDefaultPreview.description',
  },
  'builtin:append:project': {
    name: 'settings:prompts.items.appendProject.name',
    description: 'settings:prompts.items.appendProject.description',
  },
  'builtin:append:global': {
    name: 'settings:prompts.items.appendGlobal.name',
    description: 'settings:prompts.items.appendGlobal.description',
  },
}

function systemGlobalName(t: TFunction, row: PromptRowLike): string {
  if (row.description.includes('尚未创建') || row.description.includes('Saving will write')) {
    return t('settings:prompts.items.systemGlobal.nameCreate')
  }
  return t('settings:prompts.items.systemGlobal.nameExists')
}

function systemGlobalDescription(t: TFunction, row: PromptRowLike): string {
  if (row.description.includes('尚未创建') || row.description.includes('Saving will write')) {
    return t('settings:prompts.items.systemGlobal.descriptionCreate')
  }
  return t('settings:prompts.items.systemGlobal.descriptionExists')
}

function agentsContextDescription(t: TFunction, row: PromptRowLike): string | null {
  if (row.source === 'global') {
    return t('settings:prompts.items.agentsGlobal.description')
  }
  if (row.source === 'project') {
    const rel =
      row.description.replace(/^工作区路径：/, '').replace(/^Workspace path:\s*/i, '').trim() ||
      row.path ||
      ''
    return t('settings:prompts.items.agentsProject.description', { rel })
  }
  return null
}

function pluginInjectDescription(t: TFunction, row: PromptRowLike): string | null {
  if (row.category !== 'plugin_inject') return null
  const parts = row.description.split('·')
  const pkg = (parts.length > 1 ? parts.slice(1).join('·') : row.description).trim()
  return t('settings:prompts.items.pluginInject.description', { pkg })
}

export function resolvePromptRowDisplay(row: PromptRowLike, t: TFunction): { name: string; description: string } {
  if (row.id === 'builtin:system:global') {
    return {
      name: systemGlobalName(t, row),
      description: systemGlobalDescription(t, row),
    }
  }

  const builtin = BUILTIN_ID_KEYS[row.id]
  if (builtin) {
    return {
      name: t(builtin.name),
      description: t(builtin.description),
    }
  }

  if (row.id.startsWith('agents:')) {
    const desc = agentsContextDescription(t, row)
    if (desc) return { name: row.name, description: desc }
  }

  const pluginDesc = pluginInjectDescription(t, row)
  if (pluginDesc) return { name: row.name, description: pluginDesc }

  return { name: row.name, description: row.description }
}