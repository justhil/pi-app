// Pi Info Reader - reads pi configuration for Settings display

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import { app } from 'electron'
import { resolveActiveSdk } from './sdk-loader'

export interface PiInfo {
  sdkVersion: string
  agentDir: string
  sessionDir: string
  authStatus: 'configured' | 'partial' | 'none'
  authProviders: { provider: string; type: 'api_key' | 'oauth' | 'subscription'; configured: boolean }[]
  currentModel?: string
  settingsFile: string
  modelsFile: string
}

export function readPiInfo(): PiInfo {
  const agentDir = join(homedir(), '.pi', 'agent')
  const info: PiInfo = {
    sdkVersion: '',
    agentDir,
    sessionDir: join(agentDir, 'sessions'),
    authStatus: 'none',
    authProviders: [],
    settingsFile: join(agentDir, 'settings.json'),
    modelsFile: join(agentDir, 'models.json'),
  }

  // SDK version（内置或全局，取决于 current.json active）
  try {
    info.sdkVersion = resolveActiveSdk(app.getPath('userData')).version
  } catch {}

  // Auth status
  try {
    const authPath = join(agentDir, 'auth.json')
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, 'utf-8'))
      info.authProviders = Object.entries(auth).map(([provider, cred]: [string, any]) => ({
        provider,
        type: cred.type || (cred.apiKey ? 'api_key' : cred.oauth ? 'oauth' : 'subscription'),
        configured: !!(cred.apiKey || cred.oauth || cred.subscription),
      }))
      const configuredCount = info.authProviders.filter(p => p.configured).length
      info.authStatus = configuredCount > 0 ? 'configured' : 'none'
    }
  } catch {}

  // Check env vars
  const envProviders = [
    { env: 'ANTHROPIC_API_KEY', provider: 'anthropic' },
    { env: 'OPENAI_API_KEY', provider: 'openai' },
    { env: 'GOOGLE_API_KEY', provider: 'google' },
    { env: 'DEEPSEEK_API_KEY', provider: 'deepseek' },
    { env: 'GROQ_API_KEY', provider: 'groq' },
  ]
  for (const { env, provider } of envProviders) {
    if (process.env[env]) {
      if (!info.authProviders.find(p => p.provider === provider)) {
        info.authProviders.push({ provider, type: 'api_key', configured: true })
        info.authStatus = 'configured'
      }
    }
  }

  return info
}

export interface ResourceList {
  skills: { name: string; source: string }[]
  prompts: { name: string; source: string }[]
  extensions: { name: string; source: string }[]
  themes: { name: string; source: string }[]
  packages: { name: string; source: string }[]
}

export function readResourceList(cwd: string): ResourceList {
  const agentDir = join(homedir(), '.pi', 'agent')
  const result: ResourceList = { skills: [], prompts: [], extensions: [], themes: [], packages: [] }

  const scan = (dir: string, source: string) => {
    if (!existsSync(dir)) return []
    try {
      return readdirSync(dir)
        .filter(name => !name.startsWith('.'))
        .map(name => {
          const full = join(dir, name)
          const isDir = statSync(full).isDirectory()
          return { name: isDir ? name : name.replace(/\.\w+$/, ''), source }
        })
    } catch { return [] }
  }

  result.skills = [...scan(join(cwd, '.pi', 'skills'), 'project'), ...scan(join(agentDir, 'skills'), 'global')]
  result.prompts = [...scan(join(cwd, '.pi', 'prompts'), 'project'), ...scan(join(agentDir, 'prompts'), 'global')]
  result.extensions = [...scan(join(cwd, '.pi', 'extensions'), 'project'), ...scan(join(agentDir, 'extensions'), 'global')]
  result.themes = scan(join(agentDir, 'themes'), 'global')
  result.packages = scan(join(agentDir, 'packages'), 'global')

  return result
}
