import { useMemoryStore } from '../stores/memoryStore'
import { useCloudAuthStore } from '../stores/cloudAuthStore'
import { withMemorySyncSession } from '../api/cloud/memory-sync'
import { flushMemoryPersist } from './memory-persistence'
import { planMemorySync, syncMemoryHash, decodeSyncMemory, type MemorySyncBaseline } from './memory-sync-plan'
import { isRecord } from '../types/json-guards'

let running = false
const changed = () => new Error('Memory synchronization stopped because the collection changed')

function ownerMetadata(all: unknown, owner: string, minimumRevision: number): Record<string, MemorySyncBaseline> {
  const invalid = () => new Error('Invalid stored memory synchronization data')
  if (!isRecord(all)) throw invalid()
  if (!Object.hasOwn(all, owner)) return Object.create(null) as Record<string, MemorySyncBaseline>
  const saved = all[owner]
  if (!isRecord(saved)) throw invalid()
  return Object.assign(Object.create(null) as Record<string, MemorySyncBaseline>, Object.fromEntries(Object.entries(saved).map(([id, value]) => {
    if (!id || id.length > 128 || id.trim() !== id || !isRecord(value) ||
      Object.keys(value).some(key => key !== 'revision' && key !== 'hash') ||
      typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < minimumRevision ||
      (value.hash !== null && (typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash)))) throw invalid()
    return [id, { revision: value.revision, hash: value.hash as string | null }]
  })))
}

/** Explicit foreground synchronization of the selected account collection.
 * Write intents contain hashes, not private payload copies. They are durable
 * before upload, so a crash or local deletion cannot turn an uncertain first
 * upload into an untracked remote record that gets downloaded again. */
export async function synchronizeMemoryCollection(owner: string, allowSensitive = false) {
  if (running) throw new Error('Memory synchronization is already running')
  const initial = useMemoryStore.getState()
  let expectedEntries = initial.entries
  let expectedBaselines = initial.memorySyncBaselines
  let expectedPending = initial.memorySyncPending
  const revision = initial.memoryCollectionRevision
  const check = () => {
    const state = useMemoryStore.getState()
    const auth = useCloudAuthStore.getState()
    if (auth.status !== 'signed-in' || auth.user?.id !== owner || state.activeMemoryOwner !== owner ||
      state.memoryCollectionRevision !== revision || state.entries !== expectedEntries ||
      state.memorySyncBaselines !== expectedBaselines || state.memorySyncPending !== expectedPending) throw changed()
  }
  check()
  const initialBaselines = ownerMetadata(expectedBaselines, owner, 1)
  const initialPending = ownerMetadata(expectedPending, owner, 0)
  running = true
  try {
    return await withMemorySyncSession(owner, async session => {
      const guard = () => { session.assertCurrent(); check() }
      const commit = async (entries: typeof expectedEntries, baselines: Record<string, MemorySyncBaseline>, pending: Record<string, MemorySyncBaseline>) => {
        guard()
        useMemoryStore.setState(state => ({ entries,
          memorySyncBaselines: { ...state.memorySyncBaselines, [owner]: baselines },
          memorySyncPending: { ...state.memorySyncPending, [owner]: pending },
        }))
        const state = useMemoryStore.getState()
        expectedEntries = state.entries
        expectedBaselines = state.memorySyncBaselines
        expectedPending = state.memorySyncPending
        await flushMemoryPersist(() => { try { guard(); return true } catch { return false } })
        guard()
      }
      guard()
      await flushMemoryPersist(() => { try { guard(); return true } catch { return false } })
      guard()
      const remote = await session.pull()
      guard()
      const baselines = initialBaselines
      const pending = initialPending
      const localIds = new Set(expectedEntries.map(entry => entry.id))
      const remoteById = new Map(remote.map(row => [row.memory_id, row]))
      const forcedDeletes = new Map<string, number>()
      for (const [id, intent] of Object.entries(pending)) {
        const row = remoteById.get(id)
        if ((intent.hash === null || !localIds.has(id)) && !row?.deleted) {
          forcedDeletes.set(id, row?.revision ?? 0)
        } else if (row && !row.deleted && row.revision === intent.revision + 1 &&
          await syncMemoryHash(decodeSyncMemory(row.payload)) === intent.hash) {
          baselines[id] = { revision: row.revision, hash: intent.hash }
        }
        guard()
      }
      const planningBase = { ...baselines }
      for (const id of forcedDeletes.keys()) delete planningBase[id]
      const plan = await planMemorySync(expectedEntries.filter(entry => !forcedDeletes.has(entry.id)), planningBase, remote.filter(row => !forcedDeletes.has(row.memory_id)))
      guard()
      for (const [id, expectedRevision] of forcedDeletes) plan.push.push({ id, expectedRevision, payload: null })
      if (!allowSensitive && plan.push.some(write => write.payload?.sensitive)) {
        throw new Error('Sensitive memories need explicit permission for cloud storage before this collection can synchronize')
      }
      const incoming = new Map(plan.pull.map(item => [item.memory.id, item.memory]))
      const removed = new Set([...plan.remove.map(item => item.id), ...forcedDeletes.keys()])
      const entries = expectedEntries.filter(entry => !removed.has(entry.id) && !incoming.has(entry.id)).concat([...incoming.values()])
      for (const item of plan.pull) { baselines[item.memory.id] = item.baseline; delete pending[item.memory.id] }
      for (const item of [...plan.remove, ...plan.acknowledge]) { baselines[item.id] = item.baseline; delete pending[item.id] }
      await commit(entries, { ...baselines }, { ...pending })
      let uploaded = 0
      for (const write of plan.push) {
        guard()
        const hash = write.payload ? await syncMemoryHash(write.payload) : null
        guard()
        pending[write.id] = { revision: write.expectedRevision, hash }
        await commit(expectedEntries, { ...baselines }, { ...pending })
        guard()
        const saved = await session.write(write.id, write.expectedRevision, write.payload ? { ...write.payload } : null)
        guard()
        const savedHash = saved.deleted ? null : await syncMemoryHash(decodeSyncMemory(saved.payload))
        guard()
        if (savedHash !== hash) throw new Error('Memory synchronization returned unexpected content')
        baselines[write.id] = { revision: saved.revision, hash }
        delete pending[write.id]
        await commit(expectedEntries, { ...baselines }, { ...pending })
        uploaded++
      }
      return { downloaded: plan.pull.length, uploaded, removed: plan.remove.length, conflicts: plan.conflicts }
    })
  } finally { running = false }
}
