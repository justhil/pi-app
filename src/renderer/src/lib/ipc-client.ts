import type { IpcMethodName, IpcRequest, IpcResponse, IpcInvoker } from '@shared/ipc-contract'
import type { AppEvent } from '@shared/app-events'

declare global {
  interface Window {
    piDesktop?: IpcInvoker & {
      onEvent: (callback: (event: AppEvent) => void) => () => void
      ping: () => string
    }
  }
}

class IpcClientImpl implements IpcInvoker {
  async invoke<M extends IpcMethodName>(method: M, request: IpcRequest<M>): Promise<IpcResponse<M>> {
    if (!window.piDesktop) {
      console.warn(`[IPC] piDesktop not available, stubbing ${method}`)
      return {} as IpcResponse<M>
    }
    return window.piDesktop.invoke(method, request)
  }
}

export const ipcClient = new IpcClientImpl()

export function onAppEvent(callback: (event: AppEvent) => void): () => void {
  if (!window.piDesktop) {
    console.warn('[IPC] piDesktop not available, event subscription disabled')
    return () => {}
  }
  return window.piDesktop.onEvent(callback)
}
