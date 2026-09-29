import { configStore } from './config-store'
import { getAgentRuntimeConfig } from './wsl/runtime-config'

/**
 * Background warm-up that must not compete with the first paint: importing the SDK module graph
 * evaluates on the browser UI thread (Electron's main JS thread), which also serves the renderer's
 * module/chunk loads — started at launch it pushed the shell's first commit from ~120ms to ~750ms.
 * The renderer calls `app.shellReady` once the shell has painted; a timer is the fallback.
 */
let started = false

export function runStartupWarmup(): void {
  if (started) return
  started = true
  // First session open / model list would otherwise pay a cold SDK import (~1s). Those reads run
  // in the preview process, so warm it there; the main process no longer needs the SDK on hot
  // paths (WSL still reads through main, so keep warming in-process there).
  const runtime = getAgentRuntimeConfig()
  if (runtime.mode === 'wsl' && runtime.distro) {
    void warmWslRuntime(runtime.distro)
  } else {
    void import('./session-preview-process').then(({ sessionPreviewProcess }) =>
      sessionPreviewProcess.warm().catch(() => {}),
    )
  }
  // Extension probe runs in the preview process; start it so the first slash / right-panel
  // catalog request finds it warm.
  void import('./extension-probe-cache').then(({ prewarmExtensionProbe }) =>
    prewarmExtensionProbe(configStore.get('currentProject') || process.cwd()),
  )
}

/**
 * WSL: refresh the captured login environment (served from cache meanwhile), revalidate the SDK
 * install, then boot the WSL preview and import the SDK there — so the first session list /
 * history read does not pay a VM wake-up + wsl.exe spawn + cold import.
 */
export async function warmWslRuntime(distro: string): Promise<void> {
  try {
    const [{ resolveWslEnv }, { resolveWslActiveSdk }, { sessionPreviewProcess }] = await Promise.all([
      import('./wsl/wsl-env'),
      import('./wsl/sdk-resolve'),
      import('./session-preview-process'),
    ])
    await resolveWslEnv(distro, { force: true })
    await resolveWslActiveSdk(distro)
    await sessionPreviewProcess.warm()
  } catch (error) {
    console.warn('[wsl] warm-up failed:', error)
  }
}

export function scheduleStartupWarmupFallback(delayMs = 4000): void {
  setTimeout(runStartupWarmup, delayMs).unref?.()
}
