export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = { context?: number; limits: Limit[] }

export type Place = { path: string; name: string; branch?: string; kind: 'worktree' | 'main' | 'folder' }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snapshot: Snapshot | null; alerted: string[]; place: Place | null }
  }
}
