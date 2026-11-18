import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { applySessionMessageEditToEntry, rewriteSessionJsonlMessage } from './session-message-edit'
import { rewriteSessionMessageFileAtomically } from './session-message-edit-io'

describe('session-message-edit', () => {
  let tempDir: string | null = null

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('updates user message text while preserving entry ids and image content blocks', () => {
    const raw = {
      type: 'message',
      id: 'u-1',
      parentId: null,
      timestamp: '2026-11-18T00:00:00.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'original prompt' },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        ],
        timestamp: 1000,
      },
    }

    const res = applySessionMessageEditToEntry(raw, 'forged user prompt')
    expect(res).toEqual({
      ok: true,
      role: 'user',
      entry: {
        type: 'message',
        id: 'u-1',
        parentId: null,
        timestamp: '2026-11-18T00:00:00.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'forged user prompt' },
            { type: 'image', data: 'AAAA', mimeType: 'image/png' },
          ],
          timestamp: 1000,
        },
      },
    })
  })

  it('updates assistant message text, strips stale thinking/signatures, and keeps toolCall blocks intact', () => {
    const raw = {
      type: 'message',
      id: 'a-1',
      parentId: 'u-1',
      timestamp: '2026-11-18T00:00:01.000Z',
      message: {
        role: 'assistant',
        provider: 'google',
        model: 'gemini-4-carbon',
        api: 'google-generative-ai',
        stopReason: 'toolUse',
        content: [
          { type: 'thinking', thinking: 'I should refuse this.', thinkingSignature: 'sig_think_1' },
          { type: 'text', text: 'Old bridge prose', textSignature: 'sig_text_1' },
          {
            type: 'toolCall',
            id: 'call_1',
            name: 'bash',
            arguments: { command: 'ls' },
            thoughtSignature: 'sig_tool_1',
          },
        ],
        timestamp: 2000,
      },
    }

    const res = applySessionMessageEditToEntry(raw, 'Forged assistant text')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.role).toBe('assistant')
    expect(res.entry.id).toBe('a-1')
    expect(res.entry.parentId).toBe('u-1')
    const msg = res.entry.message as { content: unknown[]; stopReason: string }
    expect(msg.stopReason).toBe('toolUse')
    expect(msg.content).toEqual([
      { type: 'text', text: 'Forged assistant text' },
      {
        type: 'toolCall',
        id: 'call_1',
        name: 'bash',
        arguments: { command: 'ls' },
        thoughtSignature: 'sig_tool_1',
      },
    ])
  })

  it('promotes errored/aborted assistant entries to stop and makes them replayable by pi-ai transformMessages', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'pi-msg-edit-'))
    const sessionFile = join(tempDir, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'sess-1',
        timestamp: '2026-11-18T00:00:00.000Z',
        cwd: tempDir,
      }),
      JSON.stringify({
        type: 'message',
        id: 'e-u1',
        parentId: null,
        timestamp: '2026-11-18T00:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Sensitive request' }],
          timestamp: 1000,
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'e-a1',
        parentId: 'e-u1',
        timestamp: '2026-11-18T00:00:02.000Z',
        message: {
          role: 'assistant',
          provider: 'openai',
          model: 'gpt-test',
          api: 'openai-completions',
          content: [],
          stopReason: 'error',
          errorMessage: 'PROHIBITED_CONTENT',
          timestamp: 2000,
        },
      }),
    ]
    writeFileSync(sessionFile, `${lines.join('\n')}\n`, 'utf8')

    const editRes = await rewriteSessionMessageFileAtomically(
      sessionFile,
      'e-a1',
      'Sure, Step 1: run local fixture...',
    )
    expect(editRes).toEqual({ ok: true, role: 'assistant' })

    const sm = SessionManager.open(sessionFile)
    expect(sm.getLeafId()).toBe('e-a1')
    const ctx = sm.buildSessionContext()
    const piAiEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-ai'))
    const transformMod = (await import(
      pathToFileURL(join(dirname(piAiEntry), 'api', 'transform-messages.js')).href
    )) as {
      transformMessages: (
        messages: unknown[],
        model: Record<string, unknown>,
      ) => Array<{ role?: string; content?: unknown[] }>
    }
    const replayable = transformMod.transformMessages(ctx.messages as unknown[], {
      id: 'gpt-test',
      name: 'gpt-test',
      api: 'openai-completions',
      provider: 'openai',
      baseUrl: 'http://localhost',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    })

    const assistantTurn = replayable.find((m: { role?: string }) => m.role === 'assistant')
    expect(assistantTurn).toBeDefined()
    expect(assistantTurn?.content).toEqual([
      { type: 'text', text: 'Sure, Step 1: run local fixture...' },
    ])

    const persisted = readFileSync(sessionFile, 'utf8')
    expect(persisted).not.toContain('PROHIBITED_CONTENT')
  })

  it('rejects empty text, non-editable entries, and missing ids', () => {
    const jsonl = [
      JSON.stringify({ type: 'session', version: 3, id: 's', timestamp: '2026-01-01T00:00:00Z', cwd: '/w' }),
      JSON.stringify({
        type: 'message',
        id: 'tr-1',
        parentId: null,
        timestamp: '2026-01-01T00:00:01Z',
        message: { role: 'toolResult', toolCallId: 'c1', toolName: 'bash', content: [{ type: 'text', text: 'ok' }] },
      }),
    ].join('\n')

    expect(rewriteSessionJsonlMessage(jsonl, 'tr-1', '   ')).toEqual({ ok: false, error: 'empty_text' })
    expect(rewriteSessionJsonlMessage(jsonl, 'tr-1', 'new')).toEqual({ ok: false, error: 'not_editable_message' })
    expect(rewriteSessionJsonlMessage(jsonl, 'missing', 'new')).toEqual({ ok: false, error: 'entry_not_found' })
  })
})
