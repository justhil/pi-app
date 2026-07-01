import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { invalidateRightPanelCatalog } from '@renderer/lib/right-panel-runtime'
import {
  commitSettingsDraft,
  draftSignature,
  loadSettingsDraftFromDisk,
  previewDraftUi,
  type SettingsDraft,
  type ThemeChoice,
  type LanguageChoice,
} from '@renderer/features/settings/settings-draft'
import {
  defaultRightPanelPrefsForCatalog,
  normalizeRightPanelOrder,
  normalizeRightPanelPrefs,
  reorderPanelIds,
} from '@shared/right-panels'
import {
  anySettingsSliceDirty,
  commitAllSettingsSlices,
  discardAllSettingsSlices,
  getDirtySettingsSlices,
  registerSettingsDirtySlice,
  subscribeSettingsDirty,
} from '@renderer/features/settings/settings-dirty-registry'

type SettingsDraftContextValue = {
  draft: SettingsDraft
  dirty: boolean
  dirtySliceLabels: string[]
  loading: boolean
  saving: boolean
  setTheme: (t: ThemeChoice) => void
  setLanguage: (l: LanguageChoice) => void
  setAutoOpenLastProject: (v: boolean) => void
  setAutoCheckRegistryUpdates: (v: boolean) => void
  setAlertSoundEnabled: (v: boolean) => void
  setAlertNotificationEnabled: (v: boolean) => void
  setAlertOnExtensionUi: (v: boolean) => void
  setAlertOnRunIdle: (v: boolean) => void
  setExtensionOverride: (id: string, enabled: boolean) => void
  setRightPanelPref: (id: string, on: boolean) => void
  reorderRightPanels: (fromId: string, toIndex: number) => void
  resetRightPanelsToDefault: () => void
  refreshRightPanelCatalog: () => Promise<void>
  discard: () => Promise<void>
  save: () => Promise<boolean>
}

const SettingsDraftContext = createContext<SettingsDraftContextValue | null>(null)

export function useSettingsDraft(): SettingsDraftContextValue {
  const ctx = useContext(SettingsDraftContext)
  if (!ctx) throw new Error('useSettingsDraft must be used within SettingsDraftProvider')
  return ctx
}

export function SettingsDraftProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [baselineSig, setBaselineSig] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sliceDirtyTick, setSliceDirtyTick] = useState(0)
  const draftDirtyRef = useRef(false)
  const draftRef = useRef<SettingsDraft | null>(null)
  const baselineSigRef = useRef('')
  const discardDraftRef = useRef<() => Promise<void>>(async () => {})

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const d = await loadSettingsDraftFromDisk(i18n.language)
      setDraft(d)
      setBaselineSig(draftSignature(d))
    } finally {
      setLoading(false)
    }
  }, [i18n.language])

  useEffect(() => {
    void reload()
  }, [reload])

  const draftDirty = draft ? draftSignature(draft) !== baselineSig : false
  draftDirtyRef.current = draftDirty
  draftRef.current = draft
  baselineSigRef.current = baselineSig

  useEffect(() => {
    return subscribeSettingsDirty(() => setSliceDirtyTick((n) => n + 1))
  }, [])

  useEffect(() => {
    return registerSettingsDirtySlice({
      id: 'app',
      label: '应用与右侧栏',
      isDirty: () => draftDirtyRef.current,
      commit: async () => {
        const d = draftRef.current
        if (!d) return
        if (draftSignature(d) === baselineSigRef.current) return
        await commitSettingsDraft(d, i18n)
        baselineSigRef.current = draftSignature(d)
        setBaselineSig(baselineSigRef.current)
      },
      discard: () => discardDraftRef.current(),
    })
  }, [i18n])

  const sliceDirty = anySettingsSliceDirty()
  const dirty = draftDirty || sliceDirty
  const dirtySliceLabels = useMemo(() => {
    void sliceDirtyTick
    return getDirtySettingsSlices().map((s) => s.label || s.id)
  }, [sliceDirtyTick, draftDirty])

  const patch = useCallback((fn: (d: SettingsDraft) => SettingsDraft) => {
    setDraft((prev) => {
      if (!prev) return prev
      const next = fn(prev)
      previewDraftUi(next, i18n)
      return next
    })
  }, [i18n])

  const discard = useCallback(async () => {
    const d = await loadSettingsDraftFromDisk(i18n.language)
    setDraft(d)
    setBaselineSig(draftSignature(d))
    previewDraftUi(d, i18n)
    useUIStore.getState().applyRightPanelRuntime(d.rightPanelCatalog, d.rightPanelPrefs, d.rightPanelOrder)
  }, [i18n])

  discardDraftRef.current = discard

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true
    setSaving(true)
    try {
      await commitAllSettingsSlices()
      setSliceDirtyTick((n) => n + 1)
      if (draftDirtyRef.current) {
        const d = draftRef.current
        if (d) setBaselineSig(draftSignature(d))
      }
      return true
    } catch (e) {
      console.error(e)
      return false
    } finally {
      setSaving(false)
    }
  }, [dirty])

  const discardAll = useCallback(async () => {
    await discardAllSettingsSlices()
    setSliceDirtyTick((n) => n + 1)
  }, [])

  const refreshRightPanelCatalog = useCallback(async () => {
    invalidateRightPanelCatalog()
    const res = await ipcClient.invoke('rightPanels.catalog')
    const cat = (res?.catalog as SettingsDraft['rightPanelCatalog']) || []
    setDraft((prev) => {
      if (!prev) return prev
      const next: SettingsDraft = {
        ...prev,
        rightPanelCatalog: cat,
        rightPanelPrefs: normalizeRightPanelPrefs(prev.rightPanelPrefs, cat),
        rightPanelOrder: normalizeRightPanelOrder(prev.rightPanelOrder, cat),
      }
      previewDraftUi(next, i18n)
      return next
    })
  }, [i18n])

  const value = useMemo((): SettingsDraftContextValue | null => {
    if (!draft) return null
    return {
      draft,
      dirty,
      dirtySliceLabels,
      loading,
      saving,
      setTheme: (t) => patch((d) => ({ ...d, theme: t })),
      setLanguage: (l) => patch((d) => ({ ...d, language: l })),
      setAutoOpenLastProject: (v) => patch((d) => ({ ...d, autoOpenLastProject: v })),
      setAutoCheckRegistryUpdates: (v) => patch((d) => ({ ...d, autoCheckRegistryUpdates: v })),
      setAlertSoundEnabled: (v) => patch((d) => ({ ...d, alertSoundEnabled: v })),
      setAlertNotificationEnabled: (v) => patch((d) => ({ ...d, alertNotificationEnabled: v })),
      setAlertOnExtensionUi: (v) => patch((d) => ({ ...d, alertOnExtensionUi: v })),
      setAlertOnRunIdle: (v) => patch((d) => ({ ...d, alertOnRunIdle: v })),
      setExtensionOverride: (id, enabled) =>
        patch((d) => ({
          ...d,
          extensionOverrides: { ...d.extensionOverrides, [id]: enabled },
        })),
      setRightPanelPref: (id, on) =>
        patch((d) => ({
          ...d,
          rightPanelPrefs: { ...d.rightPanelPrefs, [id]: on },
        })),
      reorderRightPanels: (fromId, toIndex) =>
        patch((d) => ({
          ...d,
          rightPanelOrder: reorderPanelIds(d.rightPanelOrder, fromId, toIndex),
        })),
      resetRightPanelsToDefault: () =>
        patch((d) => ({
          ...d,
          rightPanelPrefs: defaultRightPanelPrefsForCatalog(d.rightPanelCatalog, []),
          rightPanelOrder: normalizeRightPanelOrder([], d.rightPanelCatalog),
        })),
      refreshRightPanelCatalog,
      discard: discardAll,
      save,
    }
  }, [draft, dirty, dirtySliceLabels, loading, saving, patch, discardAll, save, refreshRightPanelCatalog])

  if (!value) {
    return <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground">加载设置…</div>
  }

  return <SettingsDraftContext.Provider value={value}>{children}</SettingsDraftContext.Provider>
}