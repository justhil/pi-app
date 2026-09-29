import { memo, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Search, X } from '@renderer/components/icons'
import { useBlockState } from '../block-state'
import { BlockFrame } from '../frame'
import { v } from '../schema'
import type { UIBlockComponentProps, UIBlockDefinition } from '../types'

type ColumnType = 'string' | 'number' | 'date' | 'boolean'
type Column = { key: string; label?: string; type?: ColumnType }
type DataTableProps = {
  title?: string
  columns?: Column[]
  rows: Array<Record<string, unknown>>
  pageSize?: number
}

const schema = v.object<DataTableProps>({
  title: v.optional(v.string()),
  columns: v.optional(
    v.array(
      v.object<Column>({
        key: v.string(),
        label: v.optional(v.string()),
        type: v.optional(v.enum(['string', 'number', 'date', 'boolean'] as const)),
      }),
    ),
  ),
  rows: v.array(v.record(), { max: 2000 }),
  pageSize: v.optional(v.number()),
})

type Sort = { key: string; dir: 'asc' | 'desc' } | null

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[,\s%$¥€£]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function inferColumns(rows: Array<Record<string, unknown>>): Column[] {
  const first = rows[0] ?? {}
  return Object.keys(first).map((key) => ({
    key,
    type: rows.every((row) => row[key] == null || toNumber(row[key]) != null) ? 'number' : 'string',
  }))
}

function compare(a: unknown, b: unknown, type: ColumnType | undefined): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (type === 'number') return (toNumber(a) ?? 0) - (toNumber(b) ?? 0)
  if (type === 'date') return new Date(String(a)).getTime() - new Date(String(b)).getTime()
  if (type === 'boolean') return Number(Boolean(a)) - Number(Boolean(b))
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

function renderCell(value: unknown, type: ColumnType | undefined): ReactNode {
  if (value == null || value === '') return <span className="uib-cell-empty">—</span>
  if (type === 'boolean') {
    const yes = value === true || value === 'true' || value === 1
    return <span className="uib-bool" data-value={yes}>{yes ? <Check /> : <X />}</span>
  }
  if (type === 'number' && typeof value === 'number') return value.toLocaleString()
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function toCsv(columns: Column[], rows: Array<Record<string, unknown>>): string {
  const escape = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)
  const lines = [columns.map((column) => escape(column.label || column.key)).join(',')]
  for (const row of rows) {
    lines.push(columns.map((column) => escape(row[column.key] == null ? '' : String(row[column.key]))).join(','))
  }
  // BOM so Excel opens UTF-8 (CJK) correctly.
  return `﻿${lines.join('\n')}`
}

const TableBody = memo(function TableBody({
  columns,
  rows,
}: {
  columns: Column[]
  rows: Array<Record<string, unknown>>
}) {
  return (
    <tbody>
      {rows.map((row, index) => (
        <tr key={index}>
          {columns.map((column) => (
            <td key={column.key} data-type={column.type ?? 'string'}>
              {renderCell(row[column.key], column.type)}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
})

function DataTable({ props, blockKey, animate }: UIBlockComponentProps<DataTableProps>) {
  const { t } = useTranslation()
  const columns = useMemo(
    () => (props.columns && props.columns.length ? props.columns : inferColumns(props.rows)),
    [props.columns, props.rows],
  )
  const pageSize = Math.max(5, Math.min(100, Math.round(props.pageSize ?? 10)))
  const [sort, setSort] = useBlockState<Sort>(blockKey, 'sort', null)
  const [query, setQuery] = useBlockState<string>(blockKey, 'query', '')
  const [page, setPage] = useBlockState<number>(blockKey, 'page', 0)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return props.rows
    return props.rows.filter((row) =>
      columns.some((column) => String(row[column.key] ?? '').toLowerCase().includes(needle)),
    )
  }, [props.rows, columns, query])
  const sorted = useMemo(() => {
    if (!sort) return filtered
    const type = columns.find((column) => column.key === sort.key)?.type
    const copy = [...filtered]
    copy.sort((a, b) => compare(a[sort.key], b[sort.key], type) * (sort.dir === 'asc' ? 1 : -1))
    return copy
  }, [filtered, sort, columns])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize)
  const paged = props.rows.length > pageSize

  const cycleSort = (key: string) =>
    setSort((previous) =>
      !previous || previous.key !== key ? { key, dir: 'asc' } : previous.dir === 'asc' ? { key, dir: 'desc' } : null,
    )
  const exportCsv = () => {
    const blob = new Blob([toCsv(columns, sorted)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${(props.title || 'table').replace(/[\\/:*?"<>|]+/g, '_')}.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <BlockFrame
      title={props.title}
      animate={animate}
      actions={
        <>
          {paged ? (
            <label className="uib-search">
              <Search className="uib-search-icon" aria-hidden />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPage(0)
                }}
                placeholder={t('timeline:uiBlock.search')}
                aria-label={t('timeline:uiBlock.search')}
              />
            </label>
          ) : null}
          <button type="button" className="uib-btn" onClick={exportCsv}>
            {t('timeline:uiBlock.exportCsv')}
          </button>
        </>
      }
    >
      <div className="uib-table-wrap">
        <table className="uib-table">
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sort?.key === column.key ? sort.dir : undefined
                return (
                  <th
                    key={column.key}
                    data-type={column.type ?? 'string'}
                    aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}
                  >
                    <button type="button" className="uib-th" onClick={() => cycleSort(column.key)}>
                      <span>{column.label || column.key}</span>
                      <span className="uib-sort" data-active={active ? 'true' : undefined} aria-hidden>
                        {active === 'desc' ? <ArrowDown /> : <ArrowUp />}
                      </span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <TableBody columns={columns} rows={visible} />
        </table>
        {visible.length === 0 ? <div className="uib-empty">{t('timeline:uiBlock.noRows')}</div> : null}
      </div>
      {paged ? (
        <footer className="uib-pager">
          <span className="uib-muted">
            {sorted.length === 0 ? 0 : current * pageSize + 1}–{Math.min(sorted.length, current * pageSize + pageSize)} /{' '}
            {sorted.length}
          </span>
          <div className="uib-pager-buttons">
            <button
              type="button"
              className="uib-icon-btn"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
              aria-label={t('timeline:uiBlock.prevPage')}
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              className="uib-icon-btn"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
              aria-label={t('timeline:uiBlock.nextPage')}
            >
              <ChevronRight />
            </button>
          </div>
        </footer>
      ) : null}
    </BlockFrame>
  )
}

export const dataTableDefinition: UIBlockDefinition<DataTableProps> = {
  name: 'data-table',
  schema,
  Component: DataTable,
  skeleton: 'rows',
}
