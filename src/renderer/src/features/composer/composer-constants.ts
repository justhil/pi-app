export interface SlashCommand {
  id: string
  name: string
  description?: string
  category: 'builtin' | 'prompt' | 'skill' | 'extension'
}

export const BUILTIN_COMMANDS: SlashCommand[] = [
  { id: 'model', name: '/model', category: 'builtin' },
  { id: 'thinking', name: '/thinking', category: 'builtin' },
  { id: 'clear', name: '/clear', category: 'builtin' },
  { id: 'compact', name: '/compact', category: 'builtin' },
  { id: 'new', name: '/new', category: 'builtin' },
  { id: 'fork', name: '/fork', category: 'builtin' },
  { id: 'clone', name: '/clone', category: 'builtin' },
  { id: 'tree', name: '/tree', category: 'builtin' },
]

export const BUILTIN_CMD_I18N: Record<string, string> = {
  model: 'composer:commands.model',
  thinking: 'composer:commands.thinking',
  clear: 'composer:commands.clear',
  compact: 'composer:commands.compact',
  new: 'composer:commands.new',
  fork: 'composer:commands.fork',
  clone: 'composer:commands.clone',
  tree: 'composer:commands.tree',
}

export const CATEGORY_COLORS: Record<string, string> = {
  builtin: 'bg-primary/15 text-primary',
  prompt: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  skill: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  extension: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
}

export const CATEGORY_LABEL_I18N: Record<string, string> = {
  builtin: 'composer:category.builtin',
  prompt: 'composer:category.prompt',
  skill: 'composer:category.skill',
  extension: 'composer:category.extension',
}