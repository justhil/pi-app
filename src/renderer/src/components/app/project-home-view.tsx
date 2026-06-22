import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, FolderOpen, Folder, Check } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

function diskProjectName(path: string) {
  return path.split(/[\\/]/).pop() || path
}

export function ProjectHomeView({
  projectName,
  subtitle,
  recentProjects,
  currentWorkspace,
  ephemeralSandboxDraft,
  onSelectProject,
  onOpenProject,
}: {
  projectName?: string
  subtitle?: string
  recentProjects: string[]
  currentWorkspace: string | null
  ephemeralSandboxDraft?: boolean
  onSelectProject: (path: string) => void
  onOpenProject: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [pickerPos, setPickerPos] = useState<{ left: number; top: number } | null>(null)
  const hasProject = !!currentWorkspace
  // 临时对话不需要选项目
  const showProjectPicker = !ephemeralSandboxDraft

  useEffect(() => {
    if (!pickerOpen) return
    const updatePos = () => {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPickerPos({
        left: rect.left + rect.width / 2,
        top: rect.bottom + 8,
      })
    }
    updatePos()
    const onDown = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        const card = document.getElementById('project-picker-card')
        if (card && !card.contains(e.target as Node)) {
          setPickerOpen(false)
        }
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [pickerOpen])

  return (
    <div className="project-home-view absolute inset-0 flex flex-col items-center justify-center px-8 transition-all duration-[var(--motion-slow)] ease-[var(--motion-ease)]">
      <div className="-translate-y-[8rem] text-center">
        <h2 className="text-[22px] font-semibold text-foreground">
          {showProjectPicker && hasProject ? (
            <>
              要在{' '}
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className="project-picker-trigger inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-primary transition-colors hover:bg-primary/10"
              >
                {projectName}
                <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', pickerOpen && 'rotate-180')} />
              </button>
              {' '}中做什么？
            </>
          ) : showProjectPicker ? (
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="project-picker-trigger inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-card/50 px-4 py-2 text-[22px] font-semibold text-foreground-secondary transition-all hover:border-primary/40 hover:text-foreground"
            >
              <FolderOpen className="h-5 w-5" />
              选择项目
              <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', pickerOpen && 'rotate-180')} />
            </button>
          ) : (
            projectName || '新对话'
          )}
        </h2>
        <p className="mt-2 text-[13px] text-foreground-secondary/70">
          {subtitle || (hasProject ? '输入消息开始新对话，或从左侧选择历史会话' : '选择一个项目文件夹开始对话')}
        </p>
      </div>

      {pickerOpen && pickerPos && createPortal(
        <div
          id="project-picker-card"
          style={{
            position: 'fixed',
            left: pickerPos.left,
            top: pickerPos.top,
            transform: 'translateX(-50%)',
            zIndex: 9999,
          }}
          className="project-picker-card w-[340px] animate-in fade-in zoom-in-95 duration-200"
        >
          <div className="overflow-hidden rounded-xl border border-border/70 bg-popover shadow-xl">
            <div className="border-b border-border/40 px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground">
              选择项目
            </div>
            <div className="max-h-[280px] overflow-y-auto py-1">
              {recentProjects.length === 0 ? (
                <p className="px-3 py-3 text-[12px] text-muted-foreground">暂无最近项目</p>
              ) : (
                recentProjects.map((path) => {
                  const active = path === currentWorkspace
                  return (
                    <button
                      key={path}
                      type="button"
                      onClick={() => {
                        setPickerOpen(false)
                        onSelectProject(path)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                        active ? 'bg-primary/10' : 'hover:bg-muted/60',
                      )}
                    >
                      <Folder className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                        {diskProjectName(path)}
                      </span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    </button>
                  )
                })
              )}
            </div>
            <div className="border-t border-border/40 p-1.5">
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false)
                  onOpenProject()
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-foreground-secondary transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                打开其他文件夹…
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
