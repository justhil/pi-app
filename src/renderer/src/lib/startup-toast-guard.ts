import { toast } from 'sonner'

const BOOT = Date.now()
const SILENCE_MS = 22_000

function muted(): boolean {
  return Date.now() - BOOT < SILENCE_MS
}

const orig = {
  info: toast.info.bind(toast),
  success: toast.success.bind(toast),
  warning: toast.warning.bind(toast),
  message: toast.message.bind(toast),
  error: toast.error.bind(toast),
}

toast.info = (message, data) => (muted() ? 0 : orig.info(message, data))
toast.success = (message, data) => (muted() ? 0 : orig.success(message, data))
toast.warning = (message, data) => (muted() ? 0 : orig.warning(message, data))
toast.message = (message, data) => (muted() ? 0 : orig.message(message, data))
toast.error = (message, data) => orig.error(message, data)

/**
 * Unmuted success toast for explicit user actions (e.g. switching models).
 * The boot guard silences passive/startup toasts; a user click must always
 * get feedback even within the first 22s of the window.
 */
export const userActionToast = {
  success: (message: Parameters<typeof toast.success>[0], data?: Parameters<typeof toast.success>[1]) =>
    orig.success(message, data),
}
