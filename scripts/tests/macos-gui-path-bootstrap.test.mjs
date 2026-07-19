import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('macOS GUI environment bootstrap', () => {
  it('should_apply_environment_bootstrap_before_electron_app_boot', () => {
    const index = readFileSync(join(root, 'src/main/index.ts'), 'utf8')
    const boot = readFileSync(join(root, 'src/main/bootstrap-path.ts'), 'utf8')
    assert.match(index, /import ['"]\.\/bootstrap-path['"]/)
    const bootstrapPosition = index.indexOf("import './bootstrap-path'")
    const electronPosition = index.indexOf("from 'electron'")
    assert.ok(bootstrapPosition >= 0 && electronPosition > bootstrapPosition)
    assert.match(boot, /shell-env/)
    assert.match(boot, /mergeLoginShellEnvironment/)
  })

  it('should_keep_linux_path_bootstrap_when_full_environment_merge_is_macos_only', () => {
    const boot = readFileSync(join(root, 'src/main/bootstrap-path.ts'), 'utf8')
    assert.match(boot, /fix-path/)
    assert.match(boot, /process\.platform\s*===\s*['"]darwin['"]/)
    assert.match(boot, /fixPath\(\)/)
  })
})