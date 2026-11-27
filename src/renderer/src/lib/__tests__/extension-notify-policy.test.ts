import { describe, expect, it } from 'vitest'
import { formatExtensionNotifyMessage, shouldShowExtensionNotify } from '../extension-notify-policy'

describe('formatExtensionNotifyMessage', () => {
  it('should_strip_git_crlf_warnings_and_verbose_git_flags_when_rewind_snapshot_fails', () => {
    const raw = [
      'Rewind: failed to capture start snapshot (Command failed: git -c core.trustctime=true -c core.checkStat=default -c core.ignoreStat=false -c core.fsmonitor=false -c core.autocrlf=false add -A',
      "warning: in the working copy of '.trellis/workspace/justhil/index.md', CRLF will be replaced by LF the next time Git touches it",
      "warning: in the working copy of '.trellis/workspace/justhil/journal-1.md', CRLF will be replaced by LF the next time Git touches it",
      "warning: in the working copy of 'android/app/src/main/java/app/munin/mobile/ui/screens/FigmaCurateEngine.kt', CRLF will be replaced by LF the next time Git touches it",
      'error: short read while indexing nul',
      'error: nul: failed to insert into database',
      "error: unable to index file 'nul'",
      'fatal: adding files failed',
      ')',
    ].join('\n')

    const formatted = formatExtensionNotifyMessage(raw)
    expect(formatted).not.toContain('CRLF will be replaced by LF')
    expect(formatted).not.toContain('core.trustctime=true')
    expect(formatted).toContain('Rewind: failed to capture start snapshot')
    expect(formatted).toContain("unable to index file 'nul'")
    expect(shouldShowExtensionNotify(formatted, 'warning')).toBe(true)
  })
})
