import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build as esbuild } from 'esbuild'

const nodeRequire = createRequire(import.meta.url)

/**
 * Build-time virtual modules for the offline AI Canvas prototype sandbox:
 * - virtual:canvas-react-runtime: self-contained minified React 18 + ReactDOM + clsx + tailwind-merge IIFE (~145KB)
 * - virtual:canvas-tailwind-preflight: official tailwindcss/lib/css/preflight.css text (zero runtime fs reads)
 */
export function canvasOfflineAssetsPlugin(rootDir: string) {
  const RUNTIME_ID = 'virtual:canvas-react-runtime'
  const PREFLIGHT_ID = 'virtual:canvas-tailwind-preflight'
  let cachedRuntimeModule: string | null = null
  let cachedPreflightModule: string | null = null

  return {
    name: 'pi-canvas-offline-assets',
    resolveId(id: string) {
      if (id === RUNTIME_ID) return `\0${RUNTIME_ID}`
      if (id === PREFLIGHT_ID) return `\0${PREFLIGHT_ID}`
      return null
    },
    async load(id: string) {
      if (id === `\0${RUNTIME_ID}`) {
        if (!cachedRuntimeModule) {
          const result = await esbuild({
            stdin: {
              contents: [
                "import * as React from 'react'",
                "import * as ReactDOM from 'react-dom'",
                "import * as ReactDOMClient from 'react-dom/client'",
                "import * as JsxRuntime from 'react/jsx-runtime'",
                "import { clsx } from 'clsx'",
                "import { twMerge } from 'tailwind-merge'",
                'window.__PI_CANVAS_RUNTIME__ = { React, ReactDOM, ReactDOMClient, JsxRuntime, clsx, twMerge }',
              ].join('\n'),
              resolveDir: rootDir,
              loader: 'js',
            },
            bundle: true,
            minify: true,
            write: false,
            format: 'iife',
            define: { 'process.env.NODE_ENV': '"production"' },
          })
          const code = result.outputFiles[0].text
          cachedRuntimeModule = `export const CANVAS_REACT_RUNTIME_JS = ${JSON.stringify(code)};\n`
        }
        return cachedRuntimeModule
      }
      if (id === `\0${PREFLIGHT_ID}`) {
        if (!cachedPreflightModule) {
          const preflightPath = nodeRequire.resolve('tailwindcss/lib/css/preflight.css')
          const css = readFileSync(preflightPath, 'utf8')
          cachedPreflightModule = `export const TAILWIND_PREFLIGHT_CSS = ${JSON.stringify(css)};\n`
        }
        return cachedPreflightModule
      }
      return null
    },
  }
}
