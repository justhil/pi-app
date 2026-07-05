import { useCallback, useEffect, useMemo, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { BUILTIN_COMMANDS, type SlashCommand } from './composer-constants'
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
    try {
      const res = await ipcClient.invoke('commands.list')
      const cmds = (res?.commands || []) as SlashCommand[]
      const names = new Set(cmds.map((c) => c.name))
      const merged = [...BUILTIN_COMMANDS.filter((b) => !names.has(b.name)), ...cmds]
      setCommands(merged)
      setCommandsSource(res?.source || 'worker')
    } catch (e) {
      console.error('commands.list failed:', e)
      setCommands(BUILTIN_COMMANDS)
    }
  }, [])

  useEffect(() => {
    if (canCompose) refreshCommands()
  }, [canCompose, refreshCommands])

  useEffect(() => {
    if (canCompose && currentWorkspace) refreshCommands()
  }, [canCompose, currentWorkspace, refreshCommands])

  useEffect(() => {
    if (currentSessionId) refreshCommands()
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