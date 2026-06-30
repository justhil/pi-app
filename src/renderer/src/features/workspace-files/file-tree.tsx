import { useCallback, useEffect, useState } from 'react'
import type { FsEntry } from './workspace-files-types'
import { joinWorkspacePath } from './path-utils'
import { FileTreeLevel, type DirLoadMeta } from './file-tree-folder-contents'

type Props = {
  workspaceRoot: string
  listDir: (path: string) => Promise<{
    ok: boolean
    entries?: FsEntry[]
    error?: string
    truncated?: boolean
    totalCount?: number
  }>
  selectedPath: string | null
  onSelectPath: (relativePath: string, isDirectory: boolean) => void
  searchQuery: string
  onContextMenuEntry?: (
    e: React.MouseEvent,
    absPath: string,
    name: string,
    relativePath: string,
    isDirectory: boolean,
  ) => void
}

export function FileTree({
  workspaceRoot,
  listDir,
  selectedPath,
  onSelectPath,
  searchQuery,
  onContextMenuEntry,
}: Props) {
  const [rootEntries, setRootEntries] = useState<FsEntry[]>([])
  const [rootMeta, setRootMeta] = useState<DirLoadMeta | undefined>()
  const [childrenMap, setChildrenMap] = useState<Record<string, FsEntry[]>>({})
  const [childrenMeta, setChildrenMeta] = useState<Record<string, DirLoadMeta>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const load = useCallback(
    async (rel: string) => {
      const res = await listDir(rel === '' ? '.' : rel)
      if (!res.ok || !res.entries) {
        return { entries: [] as FsEntry[], meta: undefined as DirLoadMeta | undefined }
      }
      const meta: DirLoadMeta | undefined =
        res.truncated || res.totalCount != null
          ? { truncated: res.truncated, totalCount: res.totalCount }
          : undefined
      return { entries: res.entries, meta }
    },
    [listDir],
  )

  useEffect(() => {
    let cancelled = false
    setRootEntries([])
    setRootMeta(undefined)
    setChildrenMap({})
    setChildrenMeta({})
    setExpanded(new Set())
    void load('.').then(({ entries, meta }) => {
      if (!cancelled) {
        setRootEntries(entries)
        setRootMeta(meta)
      }
    })
    return () => {
      cancelled = true
    }
  }, [load, workspaceRoot])

  const toggleFolder = useCallback(
    (dirPath: string) => {
      if (expanded.has(dirPath)) {
        setExpanded((prev) => {
          const next = new Set(prev)
          next.delete(dirPath)
          return next
        })
        return
      }
      setExpanded((prev) => new Set(prev).add(dirPath))
      if (!childrenMap[dirPath]) {
        void load(dirPath).then(({ entries, meta }) => {
          setChildrenMap((m) => (m[dirPath] ? m : { ...m, [dirPath]: entries }))
          if (meta) setChildrenMeta((mm) => (mm[dirPath] ? mm : { ...mm, [dirPath]: meta }))
        })
      }
    },
    [expanded, childrenMap, load],
  )

  const joinAbs = useCallback((rel: string) => joinWorkspacePath(workspaceRoot, rel), [workspaceRoot])

  return (
    <div className="min-h-0 flex-1">
      <FileTreeLevel
        workspaceRoot={workspaceRoot}
        entries={rootEntries}
        depth={0}
        parentTree={false}
        searchQuery={searchQuery}
        dirMeta={rootMeta}
        expanded={expanded}
        childrenMap={childrenMap}
        childrenMeta={childrenMeta}
        selectedPath={selectedPath}
        onToggleFolder={toggleFolder}
        onSelectPath={onSelectPath}
        onContextMenuEntry={onContextMenuEntry}
        joinAbs={joinAbs}
      />
    </div>
  )
}