import { describe, expect, it } from 'vitest'
import { AuthStore } from '../auth-store'
import { FakeHost } from '../testing/fake-host'

const pub = new Uint8Array(32).fill(7)

describe('host key persistence', () => {
  it('keeps the same host key and pairings across restarts', () => {
    const host = new FakeHost({ projects: [] })
    const first = new AuthStore(host)
    const key = Buffer.from(first.hostKey().pub).toString('hex')
    first.registerDevice(pub, 'phone', 'android')
    const second = new AuthStore(host)
    expect(Buffer.from(second.hostKey().pub).toString('hex')).toBe(key)
    expect(second.findDevice(pub)).toBeDefined()
  })

  it('a temporarily unreadable key (locked keyring) does not wipe the key or the devices', () => {
    const host = new FakeHost({ projects: [] })
    const first = new AuthStore(host)
    const key = Buffer.from(first.hostKey().pub).toString('hex')
    first.registerDevice(pub, 'phone', 'android')
    const sealed = (host.store.get('remote') as { hostKeySealed: string }).hostKeySealed

    const open = host.secrets.open
    host.secrets.open = () => null
    const locked = new AuthStore(host)
    expect(Buffer.from(locked.hostKey().pub).toString('hex')).not.toBe(key)
    expect(locked.hostKeyIsEphemeral).toBe(true)
    expect((host.store.get('remote') as { hostKeySealed: string }).hostKeySealed).toBe(sealed)
    expect(locked.findDevice(pub)).toBeDefined()

    host.secrets.open = open
    const unlocked = new AuthStore(host)
    expect(Buffer.from(unlocked.hostKey().pub).toString('hex')).toBe(key)
    expect(unlocked.findDevice(pub)).toBeDefined()
  })
})
