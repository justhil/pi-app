// Schemas - Runtime validation for AppEvent and IPC
// This file will be fully implemented in the ipc-contract task

import { z } from 'zod'

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

export const appEventSchema = z.discriminatedUnion('type', [
  messageEventSchema,
  toolEventSchema,
  fileEventSchema,
  runEventSchema,
])
