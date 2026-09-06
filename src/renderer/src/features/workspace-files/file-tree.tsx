import { useCallback, useEffect, useState } from 'react'
import type { FsEntry } from './workspace-files-types'
import { joinWorkspacePath } from './path-utils'
import { FileTreeLevel, type DirLoadMeta } from './file-tree-folder-contents'
import { useReviewGitData } from '@renderer/features/review/use-review-git-data'
import { parseGitStatus } from '@renderer/features/review/review-git-utils'

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
  onSelectPath: (relativePath: string, isDirectory: boolean, opts?: { openInNewTab?: boolean }) => void
  searchQuery: string
  collapseEpoch?: number
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
  collapseEpoch,
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
    if (collapseEpoch) setExpanded(new Set())
  }, [collapseEpoch])

  useEffect(() => {
    const q = searchQuery.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!q.includes('/')) return
    const parts = q.split('/').filter(Boolean)
    let acc = ''
    for (const part of parts.slice(0, -1)) {
      acc = acc ? `${acc}/${part}` : part
      const dirPath = acc
      setExpanded((prev) => (prev.has(dirPath) ? prev : new Set(prev).add(dirPath)))
      setChildrenMap((m) => {
        if (m[dirPath]) return m
        void load(dirPath).then(({ entries, meta }) => {
          setChildrenMap((mm) => (mm[dirPath] ? mm : { ...mm, [dirPath]: entries }))
          if (meta) setChildrenMeta((metaMap) => (metaMap[dirPath] ? metaMap : { ...metaMap, [dirPath]: meta }))
        })
        return m
      })
    }
  }, [searchQuery, load])
  const { gitData } = useReviewGitData({
    enabled: !!workspaceRoot,
    workspace: workspaceRoot,
    worktreeChangeSignal: workspaceRoot,
  })
  const gitByPath = Object.fromEntries(
    parseGitStatus(gitData?.status || '').map((row) => [row.path.replace(/\\/g, '/'), row.changeType]),
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
        gitByPath={gitByPath}
      />
    </div>
  )
}