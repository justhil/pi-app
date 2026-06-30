import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FsEntry } from './workspace-files-types'
import { FileTreeRow } from './file-tree-row'
import { FileTreeFolderExpand } from './file-tree-folder-expand'
import {
  FOLDER_EXPAND_ANIMATION_MAX_ENTRIES,
  FOLDER_INITIAL_VISIBLE,
  FOLDER_VISIBLE_STEP,
  SEARCH_MAX_VISIBLE_PER_LEVEL,
} from './file-tree-limits'

export type DirLoadMeta = { truncated?: boolean; totalCount?: number }

type LevelProps = {
  workspaceRoot: string
  entries: FsEntry[]
  depth: number
  parentTree: boolean
  searchQuery: string
  dirMeta?: DirLoadMeta
  expanded: Set<string>
  childrenMap: Record<string, FsEntry[]>
  childrenMeta: Record<string, DirLoadMeta>
  selectedPath: string | null
  onToggleFolder: (dirPath: string) => void
  onSelectPath: (relativePath: string, isDirectory: boolean) => void
  onContextMenuEntry?: (
    e: React.MouseEvent,
    absPath: string,
    name: string,
    relativePath: string,
    isDirectory: boolean,
  ) => void
  joinAbs: (rel: string) => string
}

function filterBySearch(entries: FsEntry[], q: string) {
  if (!q) return entries
  return entries.filter((e) => e.name.toLowerCase().includes(q))
}

function FileTreeLevelInner(props: LevelProps) {
  const { t } = useTranslation('files')
  const {
    workspaceRoot,
    entries,
    depth,
    parentTree,
    searchQuery,
    dirMeta,
    expanded,
    childrenMap,
    childrenMeta,
    selectedPath,
    onToggleFolder,
    onSelectPath,
    onContextMenuEntry,
    joinAbs,
  } = props

  const q = searchQuery.trim().toLowerCase()
  const filtered = useMemo(() => filterBySearch(entries, q), [entries, q])
  const searchCapped = q.length > 0 && filtered.length > SEARCH_MAX_VISIBLE_PER_LEVEL
  const displaySource = searchCapped ? filtered.slice(0, SEARCH_MAX_VISIBLE_PER_LEVEL) : filtered

  const [visibleCount, setVisibleCount] = useState(FOLDER_INITIAL_VISIBLE)
  useEffect(() => {
    setVisibleCount(FOLDER_INITIAL_VISIBLE)
  }, [entries, q])

  const windowed = q ? displaySource : displaySource.slice(0, visibleCount)
  const canLoadMore = !q && displaySource.length > visibleCount

  if (filtered.length === 0 && q) return null

  return (
    <ul
      className={
        parentTree ? 'sidebar-session-tree ml-3 list-none border-l border-border/40 pl-1.5 pt-0.5' : 'list-none p-0'
      }
    >
      {dirMeta?.truncated ? (
        <li className="px-2 py-1 text-[10px] text-foreground-secondary/75">
          {t('tree.dirTruncated', { shown: entries.length, total: dirMeta.totalCount ?? entries.length })}
        </li>
      ) : null}
      {searchCapped ? (
        <li className="px-2 py-1 text-[10px] text-foreground-secondary/75">
          {t('tree.searchCapped', { shown: SEARCH_MAX_VISIBLE_PER_LEVEL, total: filtered.length })}
        </li>
      ) : null}
      {windowed.map((e) => {
        const open = expanded.has(e.path)
        const childEntries = childrenMap[e.path]
        const childMeta = childrenMeta[e.path]
        const childCount = childEntries?.length ?? 0
        const heavy = childCount > FOLDER_EXPAND_ANIMATION_MAX_ENTRIES

        return (
          <li key={e.path} className="tree-node">
            <FileTreeRow
              workspaceRoot={workspaceRoot}
              name={e.name}
              relativePath={e.path}
              isDirectory={e.isDirectory}
              depth={depth}
              open={open}
              selected={selectedPath === e.path}
              onToggle={() => onToggleFolder(e.path)}
              onSelect={() => onSelectPath(e.path, e.isDirectory)}
              onContextMenu={(ev) => {
                onContextMenuEntry?.(ev, joinAbs(e.path), e.name, e.path, e.isDirectory)
              }}
            />
            {e.isDirectory ? (
              <FileTreeFolderExpand open={open} motion={heavy ? 'none' : 'normal'}>
                {childEntries ? (
                  <FileTreeLevelInner
                    {...props}
                    entries={childEntries}
                    depth={depth + 1}
                    parentTree
                    dirMeta={childMeta}
                  />
                ) : null}
              </FileTreeFolderExpand>
            ) : null}
          </li>
        )
      })}
      {canLoadMore ? (
        <li className="px-1 py-0.5">
          <button
            type="button"
            className="w-full rounded-md px-2 py-1 text-left text-[11px] text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
            onClick={() => setVisibleCount((n) => Math.min(displaySource.length, n + FOLDER_VISIBLE_STEP))}
          >
            {t('tree.loadMore', { count: Math.min(FOLDER_VISIBLE_STEP, displaySource.length - visibleCount) })}
          </button>
        </li>
      ) : null}
    </ul>
  )
}

export const FileTreeLevel = memo(FileTreeLevelInner)