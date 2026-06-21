import { Toaster } from 'sonner'

/** 全局唯一 Sonner 实例，避免重复挂载导致重复提示音 */
export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      visibleToasts={4}
      expand={false}
      toastOptions={{ duration: 2800 }}
    />
  )
}