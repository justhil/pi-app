import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { btnCompact, btnOutline, inputCls } from '@renderer/features/settings/settings-controls'
import type { SshHostFormValues } from './ssh-types'

const initialForm: SshHostFormValues = { host: '', label: '', port: '', identityFile: '', remotePath: '~' }

function SshFormFields({ form, change }: {
  form: SshHostFormValues
  change: (field: keyof SshHostFormValues, value: string) => void
}) {
  const { t } = useTranslation('ssh')
  const field = (key: keyof SshHostFormValues) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => change(key, event.target.value),
    className: inputCls,
  })
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <input type="text" {...field('host')} aria-label={t('hostLabel')} placeholder={t('hostPlaceholder')} />
      <input type="text" {...field('label')} aria-label={t('nameLabel')} placeholder={t('namePlaceholder')} />
      <input type="text" {...field('remotePath')} aria-label={t('remoteDirectory')} placeholder={t('directoryPlaceholder')} />
      <div className="flex gap-2">
        <input type="text" inputMode="numeric" {...field('port')} aria-label={t('portLabel')} placeholder={t('portPlaceholder')} />
        <input type="text" {...field('identityFile')} aria-label={t('keyLabel')} placeholder={t('keyPlaceholder')} />
      </div>
    </div>
  )
}

export function SshHostForm({ busy, onAdd, onCancel }: {
  busy: boolean
  onAdd: (form: SshHostFormValues) => void
  onCancel: () => void
}) {
  const { t } = useTranslation('ssh')
  const [form, setForm] = useState(initialForm)
  const change = (key: keyof SshHostFormValues, value: string) => {
    setForm((current) => ({ ...current, [key]: key === 'port' ? value.replace(/\D/g, '') : value }))
  }
  return (
    <div className="mb-3 space-y-2.5 rounded-lg border border-border/50 bg-[var(--bg-1)]/50 p-3">
      <div className="text-xs font-medium text-foreground">{t('addTitle')}</div>
      <SshFormFields form={form} change={change} />
      <div className="flex justify-end gap-2">
        <button type="button" className={btnCompact} onClick={onCancel}>{t('common:cancel')}</button>
        <button type="button" className={btnOutline} disabled={busy || !form.host.trim()} onClick={() => onAdd(form)}>
          {t('saveHost')}
        </button>
      </div>
    </div>
  )
}
