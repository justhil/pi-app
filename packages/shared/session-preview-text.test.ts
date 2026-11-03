import { describe, expect, it } from 'vitest'
import { sessionPreviewText } from './session-preview-text'

describe('sessionPreviewText', () => {
  it('drops pasted image paths so the typed text leads', () => {
    expect(sessionPreviewText(
      'C:\\Users\\me\\AppData\\Roaming\\pi-desktop\\clipboard-images\\pi-clipboard-70458e72.png 做一下这份东西',
    )).toBe('做一下这份东西')
  })

  it('shortens file mentions and plain paths to their names', () => {
    expect(sessionPreviewText(
      'C:\\tmp\\shot.PNG @C:/Users/me/Downloads/实验2_报告模板.docx 完成这个',
    )).toBe('@实验2_报告模板.docx 完成这个')
    expect(sessionPreviewText('read /home/me/project/notes.md please')).toBe('read notes.md please')
    expect(sessionPreviewText('look at \\\\server\\share\\a.txt')).toBe('look at a.txt')
  })

  it('leaves commands, relative paths and ordinary text alone', () => {
    expect(sessionPreviewText('/fork from here')).toBe('/fork from here')
    expect(sessionPreviewText('fix src/main/index.ts  now')).toBe('fix src/main/index.ts now')
    expect(sessionPreviewText('')).toBe('')
  })

  it('is empty for an image-only message', () => {
    expect(sessionPreviewText('D:/pics/a.jpg /home/me/b.webp')).toBe('')
  })
})
