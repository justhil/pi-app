// Universal tool icon resolver (兼容层 v2).
// Built-in tools keep quiet mono icons; plugin tools resolve icon from adapter.json toolCard.icon.
// No per-plugin if(name===) branches — all plugin icons come from the adapter catalog.
import { memo, type ComponentType } from 'react'
import {
  FileText,
  FileEdit,
  Terminal,
  Wrench,
  Image as ImageIcon,
  Globe,
  GitBranch,
  MessageCircleQuestion,
  Search,
  Eye,
  ShieldCheck,
  BrainCircuit,
  Network,
  MessagesSquare,
  Lightbulb,
  Play,
  Scissors,
  Sparkles,
  Zap,
  Palette,
  Users,
  FolderTree,
  List,
  PencilLine,
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { resolveAdapterForTool } from './tool-card-registry'

// Static icon map — production bundle cannot dynamic-import, so enumerate lucide names used by adapters.
const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  FileText,
  FileEdit,
  Terminal,
  Wrench,
  Image: ImageIcon,
  Globe,
  GitBranch,
  MessageCircleQuestion,
  Search,
  Eye,
  ShieldCheck,
  BrainCircuit,
  Network,
  MessagesSquare,
  Lightbulb,
  Play,
  Scissors,
  Sparkles,
  Zap,
  Palette,
  Users,
  FolderTree,
  List,
  PencilLine,
}

// Built-in tools → stable lucide glyph (color stays neutral for visual unity)
const BUILTIN_ICON: Record<string, ComponentType<{ className?: string }>> = {
  read: FileText,
  edit: PencilLine,
  write: FileEdit,
  insert: FileEdit,
  bash: Terminal,
  ls: FolderTree,
  find: Search,
  fffind: Search,
  grep: Search,
  ffgrep: Search,
}

function ToolIconImpl({ name, className }: { name: string; className?: string }) {
  const cls = className || 'h-3.5 w-3.5'
  const Builtin = BUILTIN_ICON[name]
  if (Builtin) {
    return <Builtin className={cn(cls, 'text-foreground-secondary/55')} />
  }
  const adapter = resolveAdapterForTool(name)
  const iconName = adapter?.toolCard?.icon
  const Comp = (iconName && ICON_MAP[iconName]) || Wrench
  return <Comp className={cn(cls, 'text-foreground-secondary/50')} />
}

export const ToolIcon = memo(ToolIconImpl)
