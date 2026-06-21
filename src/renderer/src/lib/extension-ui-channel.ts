import { toast } from 'sonner'
import { onExtensionUIRequest } from '@renderer/lib/ipc-client'
import { useExtensionUIStore, type ExtensionUIPending } from '@renderer/stores/extension-ui-store'
import { shouldShowExtensionNotify } from '@renderer/lib/extension-notify-policy'
import { signalDesktopAlert } from '@renderer/lib/desktop-alerts'
import type { AskQuestionPayload } from '@renderer/features/extension-ui/questionnaire-dialog'
import type { ImageReviewPayload } from '@renderer/features/extension-ui/image-review-dialog'

let started = false

function rawToPending(raw: Record<string, unknown>): ExtensionUIPending | null {
  const id = raw.id as string
  const method = raw.method as string
  if (method === 'custom' && raw.kind === 'ask_user_question') {
    return { id, method: 'ask_user_question', questions: (raw.questions as AskQuestionPayload[]) || [] }
  }
  if (method === 'custom' && raw.kind === 'image_review') {
    return {
      id,
      method: 'image_review',
      payload: {
        image: (raw.image as string) || '',
        title: (raw.title as string) || '图片审查',
        question: (raw.question as string) || '这张图片是否可用？',
        context: raw.context as string | undefined,
        options: (raw.options as string[]) || ['通过', '需要修改', '重做', '取消'],
        allowFeedback: raw.allowFeedback !== false,
      },
    }
  }
  if (method === 'select') {
    return { id, method: 'select', title: raw.title as string, options: (raw.options as string[]) || [] }
  }
  if (method === 'confirm') {
    return { id, method: 'confirm', title: raw.title as string, message: raw.message as string }
  }
  if (method === 'input') {
    return {
      id,
      method: 'input',
      title: raw.title as string,
      placeholder: raw.placeholder as string | undefined,
    }
  }
  return null
}

/** 只注册一次 IPC 监听，避免 StrictMode 双挂载导致重复 toast / 双提示音 */
export function ensureExtensionUIChannel(): void {
  if (started) return
  started = true

  onExtensionUIRequest((raw) => {
    const req = raw as Record<string, unknown>
    const method = req.method as string

    if (method === 'notify') {
      const t = (req.notifyType as string) || 'info'
      const msg = req.message as string
      if (!shouldShowExtensionNotify(msg, t)) return
      if (t === 'error') toast.error(msg)
      else if (t === 'warning') toast.warning(msg)
      else toast.info(msg)
      return
    }

    const p = rawToPending(req)
    if (!p) return
    useExtensionUIStore.getState().setActivePending(p)
    const title =
      p.method === 'image_review'
        ? p.payload.title || '图片审查'
        : p.method === 'ask_user_question'
          ? '扩展问答'
          : p.method === 'confirm' || p.method === 'select' || p.method === 'input'
            ? p.title || '需要你的操作'
            : '需要你的操作'
    void signalDesktopAlert('extension_ui', {
      title: 'pi Desktop · 等待操作',
      body: title,
    })
  })
}