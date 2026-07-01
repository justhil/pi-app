// Universal tool icon resolver (兼容层 v2).
// Built-in tools keep semantic colors; plugin tools resolve icon from adapter.json toolCard.icon (lucide name).
// No per-plugin if(name===) branches — all plugin icons come from the adapter catalog.
import type { ComponentType } from 'react'
import {
  FileText, FileEdit, Terminal, Wrench, Image as ImageIcon, Globe, GitBranch,
  MessageCircleQuestion, Search, Eye, ShieldCheck, BrainCircuit, Network,
  MessagesSquare, Lightbulb, Play, Scissors, Sparkles, Terminal as TerminalIcon,
  Zap, Palette, Users, HelpCircle,
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { resolveAdapterForTool } from './tool-card-registry'

// Static icon map — production bundle cannot dynamic-import, so enumerate lucide names used by adapters.
const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  FileText, FileEdit, Terminal, Wrench, Image: ImageIcon, Globe, GitBranch,
  MessageCircleQuestion, Search, Eye, ShieldCheck, BrainCircuit, Network,
  MessagesSquare, Lightbulb, Play, Scissors, Sparkles, TerminalIcon,
  Zap, Palette, Users,
}

// Built-in tools with semantic color tokens (read/edit/bash).
const BUILTIN_COLORS: Record<string, string> = {
  read: 'text-[hsl(var(--tool-read))]',
  edit: 'text-[hsl(var(--tool-edit))]',
  write: 'text-[hsl(var(--tool-edit))]',
  bash: 'text-[hsl(var(--tool-bash))]',
}

export function ToolIcon({ name, className }: { name: string; className?: string }) {
  const cls = className || 'h-3.5 w-3.5'
  // Built-in semantic-color tools
  if (BUILTIN_COLORS[name]) {
    const Comp = ICON_MAP[name === 'write' ? 'FileEdit' : name === 'bash' ? 'Terminal' : 'FileText'] || Wrench
    return <Comp className={cn(cls, BUILTIN_COLORS[name])} />
  }
  // Plugin tools: resolve icon from adapter catalog
  const adapter = resolveAdapterForTool(name)
  const iconName = adapter?.toolCard?.icon
  const Comp = (iconName && ICON_MAP[iconName]) || Wrench
  return <Comp className={cn(cls, 'text-muted-foreground')} />
}
