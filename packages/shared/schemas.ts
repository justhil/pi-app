// Schemas - Runtime validation using zod

import { z } from 'zod'

// ── AppEvent schemas ──
export const appEventBaseSchema = z.object({
  seq: z.number(),
  workspaceId: z.string(),
  sessionId: z.string().optional(),
  runId: z.string().optional(),
  turnId: z.string().optional(),
  timestamp: z.number(),
})

export const messageEventSchema = appEventBaseSchema.extend({
  type: z.literal('message'),
  role: z.enum(['user', 'assistant', 'system']),
  phase: z.enum(['start', 'delta', 'end']),
  text: z.string().optional(),
})

export const toolEventSchema = appEventBaseSchema.extend({
  type: z.literal('tool'),
  toolCallId: z.string(),
  toolName: z.string(),
  phase: z.enum(['start', 'update', 'end']),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  details: z.unknown().optional(),
  isError: z.boolean().optional(),
})

export const fileEventSchema = appEventBaseSchema.extend({
  type: z.literal('file'),
  source: z.enum(['edit', 'write', 'bash-diff', 'git']),
  path: z.string(),
  changeType: z.enum(['added', 'modified', 'deleted', 'renamed']),
})

export const runEventSchema = appEventBaseSchema.extend({
  type: z.literal('run'),
  phase: z.enum(['started', 'running', 'idle', 'failed', 'cancelled']),
  model: z.string().optional(),
  thinkingLevel: z.string().optional(),
  usage: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    cost: z.number(),
  }).optional(),
  toolStats: z.object({
    total: z.number(),
    running: z.number(),
    failed: z.number(),
  }).optional(),
})

export const compactionEventSchema = appEventBaseSchema.extend({
  type: z.literal('compaction'),
  phase: z.enum(['start', 'end']),
  tokensBefore: z.number().optional(),
  tokensSaved: z.number().optional(),
  summary: z.string().optional(),
})

export const appEventSchema = z.discriminatedUnion('type', [
  messageEventSchema,
  toolEventSchema,
  fileEventSchema,
  runEventSchema,
  compactionEventSchema,
])

// ── Diff schemas ──
export const diffLineSchema = z.object({
  type: z.enum(['added', 'removed', 'context', 'hunk-header']),
  content: z.string(),
  oldLineNumber: z.number().optional(),
  newLineNumber: z.number().optional(),
})

export const diffHunkSchema = z.object({
  oldStart: z.number(),
  oldEnd: z.number(),
  newStart: z.number(),
  newEnd: z.number(),
  lines: z.array(diffLineSchema),
})

export const diffFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'copied']),
  changeType: z.enum(['added', 'modified', 'deleted', 'renamed']),
  additions: z.number(),
  deletions: z.number(),
  hunks: z.array(diffHunkSchema),
  binary: z.boolean(),
  large: z.boolean(),
  generated: z.boolean(),
})

export const diffResultSchema = z.object({
  files: z.array(diffFileSchema),
  totalAdditions: z.number(),
  totalDeletions: z.number(),
  baseCommit: z.string().optional(),
  headCommit: z.string().optional(),
})

// ── Extension schemas ──
export const compatibilityLevelSchema = z.enum(['native', 'basic', 'headless', 'blocked'])

export const extensionInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  compatibility: compatibilityLevelSchema,
  source: z.enum(['global', 'project', 'package']),
  registeredTools: z.array(z.string()),
  registeredCommands: z.array(z.string()),
  loadError: z.string().optional(),
})

// ── Registry schema ──
export const remoteAdapterEntrySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  compatibility: compatibilityLevelSchema,
  match: z.object({
    tools: z.array(z.string()).optional(),
    commands: z.array(z.string()).optional(),
  }),
  versionRange: z.string().optional(),
  rendererMap: z.record(z.string(), z.string()).optional(),
  configSchema: z.record(z.string(), z.unknown()).optional(),
  defaultConfig: z.record(z.string(), z.unknown()).optional(),
  risk: z.object({
    level: z.enum(['low', 'medium', 'high']),
    message: z.string(),
  }).optional(),
  docsUrl: z.string().optional(),
})

export const registryFileSchema = z.object({
  version: z.string(),
  minAppVersion: z.string().optional(),
  adapters: z.array(remoteAdapterEntrySchema),
})

// ── Session/Model schemas ──
export const sessionInfoSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  modelId: z.string(),
  status: z.enum(['idle', 'busy', 'error']),
})

export const modelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  contextWindow: z.number(),
  maxOutput: z.number(),
  available: z.boolean(),
})

export const thinkingLevelSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
