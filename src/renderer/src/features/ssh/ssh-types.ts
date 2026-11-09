export interface SshHostItem {
  host: string
  label?: string
  hostName?: string
  user?: string
  port?: number
  identityFile?: string
  remotePath?: string
  source: 'config' | 'custom' | 'both'
  enabled: boolean
}

export interface SshRuntime {
  mode: 'host' | 'wsl'
  distro: string | null
}

export interface SshHostFormValues {
  host: string
  label: string
  port: string
  identityFile: string
  remotePath: string
}

export interface SshProbeResult {
  ok: boolean
  distro: string
  node: boolean
  nodeVersion?: string
  nodePath?: string
  npm: boolean
  git: boolean
  pi: boolean
  sdk: boolean
  sdkVersion?: string
  sdkPath?: string
  home?: string
  shell?: string
  envMode?: 'interactive-login' | 'login' | 'plain'
  pathExtras?: string[]
  error?: string
}

export interface RemoteDirEntry {
  name: string
  path: string
}

export interface RemoteDirListing {
  ok: boolean
  cwd: string
  parent: string | null
  dirs: RemoteDirEntry[]
  error?: string
}
