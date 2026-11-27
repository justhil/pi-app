import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildActiveSnippetsPayload,
  parseSnippetStyleSettings,
} from '@shared/theme-pack'
import { settingsSetSchema } from '../ipc/schemas'
import {
  deleteCssSnippet,
  deleteThemePack,
  listCssSnippets,
  listThemePacks,
  patchCssSnippet,
  saveCssSnippet,
  saveThemePack,
} from '../theme-library'

describe('theme-library & CSS snippets with @settings', () => {
  it('should_save_list_and_delete_theme_packs_with_render_fx_fields_and_block_path_traversal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-theme-lib-'))
    const themesDir = join(root, 'themes')

    const saved = await saveThemePack(themesDir, {
      name: 'My Liquid Studio',
      theme: {
        dark: {
          preset: null,
          accent: '#f6833b',
          surface: '#101310',
          ink: '#f6fff5',
          contrast: 58,
          fontUi: null,
          fontCode: null,
          translucentSidebar: true,
          frameStyle: 'island',
          messageStyle: 'editorial',
          contentWidth: 960,
          density: 'compact',
          accentPresence: 'balanced',
          surfaceMaterial: 'liquid-glass',
          windowMaterial: 'mica',
          glassRefraction: 28,
          glassFrost: 12,
          glassTintAlpha: 0.62,
          glassSpecular: 0.7,
          glassDispersion: true,
          backdropPreset: 'ambient',
          backdropIntensity: 0.45,
          codeTheme: 'everforest-dark',
        },
      },
      customCss: '.custom-pill { border-radius: 99px; }',
    })

    const listed = await listThemePacks(themesDir)
    expect(listed).toHaveLength(1)
    expect(listed[0].name).toBe('My Liquid Studio')
    expect(listed[0].theme.dark).toMatchObject({
      frameStyle: 'island',
      messageStyle: 'editorial',
      surfaceMaterial: 'liquid-glass',
      glassRefraction: 28,
      codeTheme: 'everforest-dark',
    })

    await expect(deleteThemePack(themesDir, '../evil')).rejects.toThrow(/invalid_pack_id/)
    await deleteThemePack(themesDir, saved.id)
    expect(await listThemePacks(themesDir)).toEqual([])
  })

  it('should_parse_snippet_style_settings_and_compile_active_variables_and_toggle_classes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-snippets-'))
    const snippetsDir = join(root, 'snippets')
    const css = [
      '/* @settings',
      '- id: --my-glow-opacity',
      '  title: Glow Opacity',
      '  type: number',
      '  default: 0.3',
      '  min: 0',
      '  max: 1',
      '  step: 0.05',
      '- id: --my-border-tint',
      '  title: Border Tint',
      '  type: color',
      '  default: #f6833b',
      '- id: fx-pill-composer',
      '  title: Pill Composer',
      '  type: toggle',
      '  default: false',
      '*/',
      '.composer-surface { border-color: var(--my-border-tint); }',
    ].join('\n')

    expect(parseSnippetStyleSettings(css)).toHaveLength(3)

    const created = await saveCssSnippet(snippetsDir, {
      name: 'Glass Tweaks',
      css,
      enabled: true,
    })
    expect(created.controls).toHaveLength(3)

    const patched = await patchCssSnippet(snippetsDir, {
      id: created.id,
      values: {
        '--my-glow-opacity': 0.75,
        '--my-border-tint': '#54b879',
        'fx-pill-composer': true,
      },
    })
    expect(patched).not.toBeNull()

    const list = await listCssSnippets(snippetsDir)
    const runtime = buildActiveSnippetsPayload(list)
    expect(runtime.classes).toEqual(['fx-pill-composer'])
    expect(runtime.css).toContain('--my-glow-opacity: 0.75;')
    expect(runtime.css).toContain('--my-border-tint: #54b879;')

    await deleteCssSnippet(snippetsDir, created.id)
    expect(await listCssSnippets(snippetsDir)).toEqual([])
  })

  it('should_validate_all_render_fx_theme_fields_through_main_ipc_settingsSetSchema_so_saving_never_drops_changes', () => {
    const parsed = settingsSetSchema.safeParse({
      key: 'customTheme',
      value: {
        light: {
          preset: 'liquid-glass',
          accent: '#0070e0',
          surface: '#f8fbff',
          ink: '#0c1524',
          contrast: 48,
          fontUi: null,
          fontCode: null,
          translucentSidebar: true,
          colors: { sidebar: '#eaf1fa', userBubble: '#e3eefc', codeBg: '#f0f5fc', border: '#cfddf0' },
          chatFontSize: 15,
          chatLineHeight: 1.62,
          radius: 16,
          shadow: 35,
          frameStyle: 'island',
          messageStyle: 'editorial',
          contentWidth: 0,
          density: 'compact',
          accentPresence: 'balanced',
          surfaceMaterial: 'liquid-glass',
          windowMaterial: 'none',
          glassRefraction: 22,
          glassFrost: 10,
          glassTintAlpha: 0.52,
          glassSpecular: 0.85,
          glassDispersion: true,
          backdropPreset: 'ambient',
          backdropIntensity: 0.88,
          codeTheme: 'catppuccin-latte',
        },
      },
    })
    expect(parsed.success).toBe(true)
  })
})
