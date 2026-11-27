import { memo } from 'react'
import {
  CloudDownload,
  ExternalLink,
  Eye,
  FileCode2,
  FileEdit,
  FileText,
  FolderTree,
  Globe,
  Image,
  Layers,
  MessageSquare,
  PencilLine,
  Plug,
  Search,
  Terminal,
  Wrench,
  normalizeLegacyIconName,
  resolveAppIcon,
  type AppIconComponent,
  type AppIconName,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { resolveAdapterForTool } from './tool-card-registry'
import { isMcpToolName } from './mcp-tool'

const BUILTIN_ICON: Record<string, AppIconComponent> = {
  read: FileText,
  edit: PencilLine,
  write: FileEdit,
  insert: FileEdit,
  bash: Terminal,
  codemode: FileCode2,
  ls: FolderTree,
  find: Search,
  fffind: Search,
  grep: Search,
  ffgrep: Search,
  browser_navigate: Globe,
  browser_snapshot: Eye,
  browser_click: ExternalLink,
  browser_hover: Eye,
  browser_drag: Layers,
  browser_type: PencilLine,
  browser_fill_form: PencilLine,
  browser_select_option: PencilLine,
  browser_press_key: Terminal,
  browser_mouse_wheel: Eye,
  browser_wait_for: Search,
  browser_tabs: Layers,
  browser_take_screenshot: Image,
  browser_devtools: Terminal,
  browser_evaluate: FileCode2,
  browser_batch: Layers,
  browser_request_help: MessageSquare,
  browser_download: CloudDownload,
  browser_pdf_save: FileText,
  browser_site_notes: FileText,
  browser_file_upload: FileEdit,
  browser_handle_dialog: MessageSquare,
  browser_cdp: Terminal,
}

export function resolveToolIconName(name: string): AppIconName {
  const adapterName = resolveAdapterForTool(name)?.toolCard?.icon
  return normalizeLegacyIconName(adapterName) ?? 'wrench'
}

function ToolIconImpl({ name, className }: { name: string; className?: string }) {
  const cls = className || 'h-3.5 w-3.5 timeline-text-quiet'
  const Builtin = BUILTIN_ICON[name]
  const adapterIcon = resolveAdapterForTool(name)?.toolCard?.icon
  const Icon =
    Builtin ?? (!adapterIcon && isMcpToolName(name) ? Plug : resolveAppIcon(resolveToolIconName(name))) ?? Wrench
  return <Icon className={cn(cls, 'text-current')} />
}

export const ToolIcon = memo(ToolIconImpl)
