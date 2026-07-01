/** 设置子页向全局底栏注册脏状态与保存/放弃（不经过 React Context 重渲染风暴） */

export type SettingsDirtySlice = {
  id: string
  /** 人类可读，底栏「未保存」旁可选展示 */
  label?: string
  isDirty: () => boolean
  commit: () => Promise<void>
  discard: () => void | Promise<void>
}

type Listener = () => void

const slices = new Map<string, SettingsDirtySlice>()
const listeners = new Set<Listener>()

function notify() {
  queueMicrotask(() => {
    for (const l of listeners) l()
  })
}

/** 子组件草稿变更时调用，刷新底栏脏状态（异步，避免渲染期 setState） */
export function notifySettingsDirtyChanged(): void {
  notify()
}

export function registerSettingsDirtySlice(slice: SettingsDirtySlice): () => void {
  slices.set(slice.id, slice)
  notify()
  return () => {
    slices.delete(slice.id)
    notify()
  }
}

export function subscribeSettingsDirty(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getDirtySettingsSlices(): SettingsDirtySlice[] {
  return [...slices.values()].filter((s) => s.isDirty())
}

export function anySettingsSliceDirty(): boolean {
  for (const s of slices.values()) {
    if (s.isDirty()) return true
  }
  return false
}

export async function commitAllSettingsSlices(): Promise<void> {
  const dirty = getDirtySettingsSlices()
  for (const s of dirty) {
    await s.commit()
  }
}

export async function discardAllSettingsSlices(): Promise<void> {
  const all = [...slices.values()]
  for (const s of all) {
    await s.discard()
  }
}