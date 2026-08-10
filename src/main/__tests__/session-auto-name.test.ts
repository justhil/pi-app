import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { autoNameTitle, cleanAutoNameText } from '../session-auto-name'

describe('cleanAutoNameText', () => {
  it('strips leading /command lines and keeps the intent', () => {
    expect(cleanAutoNameText('/batch-grill-with-docs\n/sanitize-commit\n我希望增加几个功能特性：\n你好')).toBe(
      '我希望增加几个功能特性： 你好',
    )
  })

  it('keeps inline slashes like "/ shift + enter" mid-text', () => {
    expect(cleanAutoNameText('修复问题：\n我在输出窗输入 换行时，/ shift + enter\n超出阈值')).toBe(
      '修复问题： 我在输出窗输入 换行时，/ shift + enter 超出阈值',
    )
  })

  it('removes URLs (not title material)', () => {
    expect(cleanAutoNameText('/sanitize-commit\n\nhttps://example.com/org/repo/pull/57 新增了3个提交')).toBe(
      '新增了3个提交',
    )
  })

  it('drops a line that is only a URL', () => {
    expect(cleanAutoNameText('https://example.com/org/repo/pull/57')).toBe('')
  })

  it('removes Windows drive paths (backslash and forward slash)', () => {
    expect(cleanAutoNameText('修改 C:\\Users\\dev\\config.json 的配置')).toBe('修改 的配置')
    expect(cleanAutoNameText('在 D:/Github/pi-app 提交代码')).toBe('在 提交代码')
  })

  it('removes Unix absolute/home/relative paths', () => {
    expect(cleanAutoNameText('看下 /tmp/build.log 和 ~/.pi/agent 目录')).toBe('看下 和 目录')
    expect(cleanAutoNameText('运行 ./scripts/build.sh 试试')).toBe('运行 试试')
  })

  it('keeps a mid-line slash phrase like "/ shift + enter" intact', () => {
    expect(cleanAutoNameText('修复问题：\n我在输出窗输入 换行时，/ shift + enter\n超出阈值')).toBe(
      '修复问题： 我在输出窗输入 换行时，/ shift + enter 超出阈值',
    )
  })

  it('collapses whitespace and trims', () => {
    expect(cleanAutoNameText('  首条消息\n\n\n第二行\t\t空白  ')).toBe('首条消息 第二行 空白')
  })
})

describe('autoNameTitle', () => {
  it('extracts first user message, truncates to 40 chars', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-auto-name-'))
    try {
      const file = join(dir, '2026-01-01T00-00-00-000Z_019f0000-0000-7000-8000-000000000000.jsonl')
      writeFileSync(
        file,
        [
          JSON.stringify({ type: 'session', id: '019f0000-0000-7000-8000-000000000000', cwd: dir }),
          JSON.stringify({
            type: 'message',
            message: {
              role: 'system',
              content: [{ type: 'text', text: 'system context' }],
            },
          }),
          JSON.stringify({
            type: 'message',
            message: {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: '/grill\n请帮我评估这个方案的可行性，它涉及很多模块的改动，需要仔细分析每一个边界情况，并且还要对比不同的实现路径和它们各自的维护成本，最后给出建议',
                },
              ],
            },
          }),
          '',
        ].join('\n'),
      )
      const title = await autoNameTitle(file)
      expect(title.startsWith('请帮我评估这个方案的可行性')).toBe(true)
      expect([...title].length).toBeLessThanOrEqual(41)
      expect(title.endsWith('…')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to sessionId head when no user message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-auto-name-'))
    try {
      const file = join(dir, '2026-01-01T00-00-00-000Z_019f0000-0000-7000-8000-000000000000.jsonl')
      writeFileSync(file, [JSON.stringify({ type: 'session', id: '019f0000-0000-7000-8000-000000000000' })].join('\n'))
      expect(await autoNameTitle(file)).toBe('019f0000')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to sessionId head when first message is only a URL/path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-auto-name-'))
    try {
      const file = join(dir, '2026-01-01T00-00-00-000Z_019f0000-0000-7000-8000-000000000000.jsonl')
      writeFileSync(
        file,
        [
          JSON.stringify({ type: 'session', id: '019f0000-0000-7000-8000-000000000000' }),
          JSON.stringify({
            type: 'message',
            message: { role: 'user', content: '/sanitize-commit\n\nhttps://example.com/org/repo/pull/57' },
          }),
        ].join('\n'),
      )
      expect(await autoNameTitle(file)).toBe('019f0000')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips partial/invalid JSONL lines mid-scan', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-auto-name-'))
    try {
      const file = join(dir, '2026-01-01T00-00-00-000Z_019f0000-0000-7000-8000-000000000000.jsonl')
      writeFileSync(
        file,
        [
          JSON.stringify({ type: 'session', id: '019f0000-0000-7000-8000-000000000000' }),
          '{"type":"message","message":{"role":"user","content":"半行', // CLI 写入中
          JSON.stringify({ type: 'message', message: { role: 'user', content: '完整消息' } }),
        ].join('\n'),
      )
      expect(await autoNameTitle(file)).toBe('完整消息')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
