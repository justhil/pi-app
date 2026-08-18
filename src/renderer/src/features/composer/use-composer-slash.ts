import { useCallback, useEffect, useMemo, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { DESKTOP_NATIVE_COMMANDS, type SlashCommand } from './composer-constants'
import { getSyncedBuiltins, setSyncedBuiltins, type SyncedBuiltin } from './slash-catalog'
import {
  type Segment,
  replaceTrailingTokenInSegments,
  stripTrailingSlashToken,
} from './attachments'

export function useComposerSlash(
  text: string,
  canCompose: boolean,
  currentSessionId: string | null,
  currentWorkspace: string | null,
  applySegmentsChange: (next: Segment[]) => void,
  currentSegments: () => Segment[],
) {
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [commandsSource, setCommandsSource] = useState<'worker' | 'fallback' | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [argCompletions, setArgCompletions] = useState<{ label: string; description?: string }[]>([])
  const [argIdx, setArgIdx] = useState(0)

  const refreshCommands = useCallback(async () => {
    const [res, builtinsRes] = await Promise.all([
      ipcClient.invoke('commands.list'),
      ipcClient.invoke('commands.builtins').catch(() => ({ builtins: [], source: 'none' })),
    ])
    const cmds = (res?.commands || []) as SlashCommand[]
    const synced = (builtinsRes?.builtins || []) as SyncedBuiltin[]
    setSyncedBuiltins(synced)
    // 桌面原生（含 i18n 描述）优先；pi 内置补足；扩展/skill/模板去重后合并。
    const piCmds: SlashCommand[] = synced.map((b) => ({
      id: b.name,
      name: `/${b.name}`,
      description: b.description,
      category: 'builtin',
    }))
    const names = new Set(DESKTOP_NATIVE_COMMANDS.map((c) => c.name))
    const builtinCmds = [
      ...DESKTOP_NATIVE_COMMANDS,
      ...piCmds.filter((c) => !names.has(c.name)),
    ]
    const builtinNames = new Set(builtinCmds.map((c) => c.name))
    const merged = [...builtinCmds, ...cmds.filter((c) => !builtinNames.has(c.name))]
    setCommands(merged)
    setCommandsSource(res?.source || 'worker')
  }, [])

  useEffect(() => {
    if (canCompose) {
      void refreshCommands().catch(() => {
        // 降级：桌面原生 + 上次同步缓存（若无缓存则为空列表）。
        const cached = getSyncedBuiltins().map((b) => ({
          id: b.name,
          name: `/${b.name}`,
          description: b.description,
          category: 'builtin' as const,
        }))
        setCommands([...DESKTOP_NATIVE_COMMANDS, ...cached])
      })
    }
  }, [canCompose, refreshCommands])

  useEffect(() => {
    if (canCompose && currentWorkspace) void refreshCommands().catch(() => {})
  }, [canCompose, currentWorkspace, refreshCommands])

  useEffect(() => {
    if (currentSessionId) void refreshCommands().catch(() => {})
  }, [currentSessionId, refreshCommands])

  const slashQuery = useMemo(() => {
    const m = text.match(/(?:^|\n)\/(\S*)$/)
    if (!m) return null
    return m[1]
  }, [text])

  const filteredCommands = useMemo(() => {
    if (slashQuery === null) return []
    const q = slashQuery.toLowerCase()
    const seen = new Set<string>()
    return commands.filter((c) => {
      const key = c.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return !q || key.includes(q) || (c.description || '').toLowerCase().includes(q)
    })
  }, [commands, slashQuery])

  const argMatch = useMemo(() => text.match(/(?:^|\n)\/(\S+)\s+(\S*)$/), [text])

  useEffect(() => {
    setArgIdx(0)
  }, [argCompletions])

  useEffect(() => {
    if (!argMatch) {
      setArgCompletions([])
      return
    }
    const cmdName = argMatch[1].replace(/^\//, '')
    const prefix = argMatch[2]
    let cancelled = false
    ipcClient
      .invoke('commands.completions', { commandName: cmdName, argumentPrefix: prefix })
      .then((res) => {
        if (!cancelled) setArgCompletions(res?.items || [])
      })
      .catch(() => {
        if (!cancelled) setArgCompletions([])
      })
    return () => {
      cancelled = true
    }
  }, [argMatch])

  useEffect(() => {
    setSelectedIdx(0)
  }, [slashQuery])

  const showPopover = slashQuery !== null && filteredCommands.length > 0

  const acceptCommand = useCallback(
    (cmd: SlashCommand) => {
      applySegmentsChange(replaceTrailingTokenInSegments(currentSegments(), `${cmd.name} `))
    },
    [applySegmentsChange, currentSegments],
  )

  const acceptArg = useCallback(
    (label: string) => {
      applySegmentsChange(replaceTrailingTokenInSegments(currentSegments(), `${label} `))
      setArgCompletions([])
    },
    [applySegmentsChange, currentSegments],
  )

  const dismissSlashToken = useCallback(() => {
    applySegmentsChange(stripTrailingSlashToken(currentSegments()))
  }, [applySegmentsChange, currentSegments])

  return {
    commandsSource,
    filteredCommands,
    argCompletions,
    selectedIdx,
    setSelectedIdx,
    argIdx,
    setArgIdx,
    showPopover,
    refreshCommands,
    acceptCommand,
    acceptArg,
    dismissSlashToken,
  }
}