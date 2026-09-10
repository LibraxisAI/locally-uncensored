// Opt-in proof against the owned local stack. No credentials or raw errors in logs.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, expect } from '@playwright/test'

const scratch = process.env.LU_LOCAL_SUPABASE_DIR
if (!scratch || !/^\/tmp\/lu-supabase\.[A-Za-z0-9]+$/.test(scratch)) throw Error('Owned local stack directory required')
const desktopDir = fileURLToPath(new URL('../', import.meta.url))
const webDir = fileURLToPath(new URL('../../web/apps/web/', import.meta.url))
const desktopUrl = 'http://127.0.0.1:5273'
const webUrl = 'http://127.0.0.1:3018'
const apiUrl = 'http://127.0.0.1:54321'
for (const port of [3018, 5273]) {
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', () => reject(Error('Proof port occupied; existing service was not touched')))
    probe.listen(port, '127.0.0.1', resolve)
  })
  await new Promise(resolve => probe.close(resolve))
}
let credentials
try {
  credentials = JSON.parse(execFileSync('npm', ['exec', '--yes', '--package=supabase@2.117.0', '--', 'supabase', 'status', '-o', 'json'], {
    cwd: scratch, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }))
} catch { throw Error('Local stack status unavailable; private diagnostics suppressed') }
assert.equal(credentials.API_URL, apiUrl)
assert.ok(credentials.ANON_KEY && credentials.SERVICE_ROLE_KEY)
// Do not inherit payment, inference, mail, or other service credentials.
const baseEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT'].flatMap(key =>
  process.env[key] === undefined ? [] : [[key, process.env[key]]]))
const children = []
const start = (path, args, cwd, env) => {
  const child = spawn(process.execPath, [path, ...args], { cwd, env: { ...baseEnv, ...env }, stdio: 'ignore', detached: true })
  child.on('error', () => { child.proofFailed = true })
  children.push(child)
  return child
}
const localFetch = (url, options = {}) => {
  if (![apiUrl, webUrl, desktopUrl].includes(new URL(url).origin)) throw Error('Nonlocal request refused')
  return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) })
}
const admin = (path, options = {}) => localFetch(`${apiUrl}${path}`, {
  ...options, headers: { apikey: credentials.SERVICE_ROLE_KEY, authorization: `Bearer ${credentials.SERVICE_ROLE_KEY}`,
    'content-type': 'application/json', ...options.headers },
})
let browser
const users = []
let stage = 'server startup'
let passed = 0
let blockedRequests = 0
let releaseHeld
const startedAt = performance.now()
const report = label => { passed++; console.log(`PASS ${passed}: ${label}`) }
const button = page => page.getByRole('button', { name: 'Sync account memories', exact: true })
const status = page => page.getByRole('status')
const consent = page => page.getByLabel('Allow cloud storage for this account collection', { exact: true }).check()
async function sync(page, uploads, downloads, conflicts = 0) {
  await button(page).click()
  await expect(status(page)).toHaveText(`Synced ${uploads} uploads and ${downloads} downloads. ${conflicts} conflicting memories left unchanged.`)
}
async function add(page, title, content) {
  await page.getByRole('button', { name: 'Add Memory', exact: true }).click()
  await page.getByPlaceholder('What should I remember?').fill(title)
  await page.getByPlaceholder('Details… (required)').fill(content)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
}
async function edit(page, content) {
  await page.getByRole('button', { name: 'Edit entry', exact: true }).click()
  await page.locator('textarea').fill(content)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
}
async function flush(page) {
  await page.evaluate(async () => { await (await import('/src/lib/memory-persistence.ts')).flushMemoryPersist() })
}
async function state(page) {
  return page.evaluate(async () => {
    const store = (await import('/src/stores/memoryStore.ts')).useMemoryStore.getState()
    return { owner: store.activeMemoryOwner, entries: store.entries, pending: store.memorySyncPending,
      baselines: store.memorySyncBaselines }
  })
}
async function login(page, user) {
  // The component fixture has no AppShell. Derive its UI auth state from real
  // SDK sign-in/getUser and the real /api/me, not synthetic identity or responses.
  const owner = await page.evaluate(async ({ email, password }) => {
    const { supabaseCloud } = await import('/src/api/cloud/supabase.ts')
    const { useCloudAuthStore } = await import('/src/stores/cloudAuthStore.ts')
    const { getMe } = await import('/src/api/cloud/jobs.ts')
    const auth = supabaseCloud().auth
    if (email) {
      const signed = await auth.signInWithPassword({ email, password })
      if (signed.error) throw Error('Local SDK sign-in failed')
    }
    const verified = await auth.getUser()
    const me = await getMe()
    if (verified.error || !verified.data.user || me.user?.id !== verified.data.user.id) throw Error('Local verified identity mismatch')
    useCloudAuthStore.getState().setSignedIn(me.user, { licenseActive: me.license?.status === 'active',
      tier: me.license?.tier ?? null, access: me.license?.access !== false, quota: null })
    return me.user.id
  }, user ? { email: user.email, password: user.password } : {})
  if (user) assert.equal(owner, user.id)
  await page.getByRole('button', { name: 'Use account memories', exact: true }).click()
  assert.equal((await state(page)).owner, owner)
}
async function rows(user) {
  const result = await admin(`/rest/v1/memory_sync?user_id=eq.${user.id}&order=memory_id`)
  assert.equal(result.status, 200)
  return result.json()
}
try {
  const next = start(`${webDir}node_modules/next/dist/bin/next`, ['dev', '--hostname', '127.0.0.1', '--port', '3018'], webDir, {
    NEXT_PUBLIC_SUPABASE_URL: apiUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: credentials.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: credentials.SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL: webUrl,
    DESKTOP_ALLOWED_ORIGINS: desktopUrl, LAUNCH_MAX_ONLY: '0', NEXT_TELEMETRY_DISABLED: '1',
  })
  const vite = start(`${desktopDir}node_modules/vite/bin/vite.js`, ['--host', '127.0.0.1', '--port', '5273', '--strictPort'], desktopDir, {
    VITE_LU_CLOUD_URL: webUrl, VITE_LU_SUPABASE_URL: apiUrl, VITE_LU_SUPABASE_ANON_KEY: credentials.ANON_KEY,
  })
  for (const [child, url] of [[next, `${webUrl}/api/me`], [vite, `${desktopUrl}/e2e/memory-sensitive-proof.html`]]) {
    let ready = false
    for (let attempt = 0; attempt < 90; attempt++) {
      if (child.exitCode !== null || child.proofFailed) throw Error('Owned server startup failed')
      try { const response = await localFetch(url); ready = response.ok; await response.arrayBuffer() } catch {}
      if (ready) break
      await delay(500)
    }
    assert.ok(ready)
  }
  const deniedOrigin = await localFetch(`${webUrl}/api/memory/sync`, {
    method: 'OPTIONS', headers: { origin: 'https://not-allowed.example.invalid', 'access-control-request-method': 'POST' },
  })
  assert.equal(deniedOrigin.status, 403)
  assert.equal(deniedOrigin.headers.get('access-control-allow-origin'), null)
  const allowedOrigin = await localFetch(`${webUrl}/api/memory/sync`, {
    method: 'OPTIONS', headers: { origin: desktopUrl, 'access-control-request-method': 'POST' },
  })
  assert.equal(allowedOrigin.status, 204)
  assert.equal(allowedOrigin.headers.get('access-control-allow-origin'), desktopUrl)
  assert.equal(allowedOrigin.headers.get('access-control-allow-credentials'), null)
  stage = 'owned GoTrue users'
  for (let index = 0; index < 2; index++) {
    const user = { email: `memory-device-${randomUUID()}@example.invalid`, password: randomUUID() + 'Aa1!' }
    const response = await admin('/auth/v1/admin/users', {
      method: 'POST', body: JSON.stringify({ ...user, email_confirm: true }),
    })
    assert.equal(response.status, 200)
    const created = await response.json()
    assert.match(created.id, /^[0-9a-f-]{36}$/)
    users.push({ ...user, id: created.id })
  }
  browser = await chromium.launch({ headless: true })
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  for (const context of contexts) {
    context.setDefaultTimeout(15000)
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      const allowed = (url.origin === desktopUrl && !/^\/(local-api|api)\//.test(url.pathname)) ||
        (url.origin === webUrl && ['/api/me', '/api/memory/sync'].includes(url.pathname)) ||
        (url.origin === apiUrl && url.pathname.startsWith('/auth/v1/'))
      if (allowed) return route.continue()
      blockedRequests++
      return route.abort()
    })
  }
  const [a, b] = await Promise.all(contexts.map(context => context.newPage()))
  for (const page of [a, b]) await page.goto(`${desktopUrl}/e2e/memory-sensitive-proof.html`)
  stage = 'two real SDK sessions and first transfer'
  await add(a, 'Local only', 'Device A local memory remains private')
  await flush(a)
  await login(a, users[0])
  await login(b, users[0])
  assert.equal((await state(a)).entries.length, 0)
  assert.equal((await state(b)).entries.length, 0)
  await expect(button(a)).toBeDisabled()
  await add(a, 'Shared preference', 'Initial shared content')
  assert.equal((await rows(users[0])).length, 0)
  await consent(a)
  await a.getByLabel('Sensitive: exclude from AI requests', { exact: true }).check()
  await button(a).click()
  await expect(status(a)).toHaveText('Sensitive memories need explicit permission for cloud storage before this collection can synchronize')
  assert.equal((await rows(users[0])).length, 0)
  await a.getByLabel('Sensitive: exclude from AI requests', { exact: true }).uncheck()
  await sync(a, 1, 0)
  await consent(b)
  await sync(b, 0, 1)
  await expect(b.getByText('Initial shared content', { exact: true })).toBeVisible()
  const memoryId = (await state(a)).entries[0].id
  assert.equal((await state(b)).entries[0].id, memoryId)
  assert.equal((await rows(users[0]))[0].revision, 1)
  report('two isolated devices use real SDK sessions, CORS, Next and PostgREST; explicit consent and sensitive refusal precede first transfer')

  stage = 'offline divergent edits and conflict review'
  await contexts[1].setOffline(true)
  await edit(b, 'Offline device B correction')
  await flush(b)
  await edit(a, 'Online device A correction')
  await sync(a, 1, 0)
  await contexts[1].setOffline(false)
  await sync(b, 0, 0, 1)
  const conflict = b.getByRole('group', { name: 'Memory conflict 1', exact: true })
  await conflict.getByText('Compare full memory records', { exact: true }).click()
  await expect(conflict.locator('pre').first()).toContainText('Offline device B correction')
  await expect(conflict.locator('pre').last()).toContainText('Online device A correction')
  assert.equal((await rows(users[0]))[0].revision, 2)
  await edit(a, 'Newer online device A correction')
  await sync(a, 1, 0)
  await b.getByRole('button', { name: 'Keep local version', exact: true }).click()
  await expect(status(b)).toHaveText('This conflict changed. Sync again before choosing a version.')
  assert.equal((await rows(users[0]))[0].revision, 3)
  await sync(b, 0, 0, 1)
  await b.getByRole('button', { name: 'Use cloud version', exact: true }).click()
  await expect(status(b)).toHaveText('Synced 0 uploads and 1 downloads. 0 conflicting memories left unchanged.')
  await expect(b.getByText('Newer online device A correction', { exact: true })).toBeVisible()
  report('offline edits conflict, a stale choice cannot overwrite a newer server revision, cloud choice converges')

  stage = 'keep local conflict resolution'
  await edit(b, 'Chosen device B correction')
  await edit(a, 'Another device A correction')
  await sync(a, 1, 0)
  await sync(b, 0, 0, 1)
  await b.getByRole('button', { name: 'Keep local version', exact: true }).click()
  await expect(status(b)).toHaveText('Synced 1 uploads and 0 downloads. 0 conflicting memories left unchanged.')
  await sync(a, 0, 1)
  assert.equal((await rows(users[0]))[0].revision, 5)
  assert.equal((await state(a)).entries[0].content, 'Chosen device B correction')
  report('explicit local choice uses actual revision-checked RPC and converges on both devices')

  stage = 'shared tombstone versus offline edit'
  await contexts[1].setOffline(true)
  await edit(b, 'Offline edit must not revive deletion')
  await flush(b)
  await a.getByRole('button', { name: 'Delete entry', exact: true }).click()
  await sync(a, 1, 0)
  await contexts[1].setOffline(false)
  await sync(b, 0, 0)
  assert.equal((await state(b)).entries.length, 0)
  assert.equal((await rows(users[0]))[0].payload, null)
  await b.reload()
  await login(b)
  assert.equal((await state(b)).entries.length, 0)
  assert.deepEqual((await state(b)).baselines[users[0].id][memoryId], { revision: 6, hash: null })
  report('server tombstone beats an offline edit, payload is removed, baseline survives real IndexedDB reload')

  stage = 'accepted upload with lost response'
  await add(a, 'Uncertain upload', 'Synthetic content with lost response')
  let dropped = false
  const drop = async route => {
    if (route.request().method() !== 'POST' || dropped) return route.fallback()
    dropped = true
    const response = await route.fetch()
    assert.equal(response.status(), 200)
    await response.dispose()
    await route.abort('failed')
  }
  await a.route(`${webUrl}/api/memory/sync`, drop)
  await button(a).click()
  await expect(status(a)).toContainText('Some changes may already be saved')
  const uncertainId = (await state(a)).entries[0].id
  assert.ok((await rows(users[0])).some(row => row.memory_id === uncertainId && !row.deleted))
  await a.unroute(`${webUrl}/api/memory/sync`, drop)
  await a.getByRole('button', { name: 'Delete entry', exact: true }).click()
  await flush(a)
  await a.reload()
  await login(a)
  assert.equal(Object.keys((await state(a)).pending[users[0].id]).length, 1)
  await consent(a)
  await sync(a, 1, 0)
  const uncertain = (await rows(users[0])).find(row => row.memory_id === uncertainId)
  assert.ok(uncertain.deleted && uncertain.payload === null && uncertain.revision === 2)
  await consent(b)
  await sync(b, 0, 0)
  assert.equal((await state(b)).entries.length, 0)
  report('real server accepted a lost first-upload response; reload plus local delete sends a tombstone, not resurrection')

  stage = 'account switch during real in-flight pull'
  await add(b, 'Account A only', 'Must never enter account B')
  await sync(b, 1, 0)
  let heldResolve
  const heldSeen = new Promise(resolve => { heldResolve = resolve })
  const held = new Promise(resolve => { releaseHeld = resolve })
  const hold = async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const response = await route.fetch()
    assert.equal(response.status(), 200)
    heldResolve()
    await held
    try { await route.fulfill({ response }) } catch { /* An aborted browser request is expected. */ }
    await response.dispose()
  }
  await a.route(`${webUrl}/api/memory/sync`, hold)
  await button(a).click()
  await Promise.race([heldSeen, delay(15000, undefined, { ref: false }).then(() => { throw Error('Held local pull not observed') })])
  await a.evaluate(async () => { await (await import('/src/hooks/useCloudAuth.ts')).signOutAccount() })
  await expect(a.getByText('Local only', { exact: true })).toBeVisible()
  await login(a, users[1])
  releaseHeld()
  await a.unroute(`${webUrl}/api/memory/sync`, hold)
  assert.equal((await state(a)).entries.length, 0)
  await expect(button(a)).toBeDisabled()
  await consent(a)
  await sync(a, 0, 0)
  assert.equal((await rows(users[1])).length, 0)
  assert.equal((await state(a)).owner, users[1].id)
  // Identical IDs in separate accounts are deliberately legal. This fixture
  // seeds only a synthetic local record; the transfer remains the actual UI.
  const accountARecord = (await state(b)).entries[0]
  await a.evaluate(async record => {
    (await import('/src/stores/memoryStore.ts')).useMemoryStore.setState({ entries: [record] })
  }, { ...accountARecord, title: 'Account B only', content: 'Distinct second account content' })
  await sync(a, 1, 0)
  assert.equal((await rows(users[1]))[0].payload.content, 'Distinct second account content')
  assert.equal((await rows(users[0])).find(row => row.memory_id === accountARecord.id).payload.content, 'Must never enter account B')
  await a.reload()
  await login(a)
  await expect(a.getByText('Account B only', { exact: true })).toBeVisible()
  await expect(a.getByText('Account A only', { exact: true })).toHaveCount(0)
  report('real sign-out and account switch discard a held old-owner pull; equal IDs remain isolated through reload')
  assert.equal(blockedRequests, 0)
  console.log(`RESULT: ${passed} joined two-device scenarios passed in ${Math.round(performance.now() - startedAt)}ms; unexpected network requests=0; no live provider calls`)
} catch {
  // Playwright errors may include evaluate arguments or request headers.
  console.error(`FAIL at stage: ${stage}; private diagnostics suppressed`)
  process.exitCode = 1
} finally {
  releaseHeld?.()
  let cleanupFailed = false
  try { await browser?.close() } catch { cleanupFailed = true }
  for (const user of users) {
    try {
      const deleted = await admin(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' })
      assert.equal(deleted.status, 200)
      assert.equal((await rows(user)).length, 0)
    } catch { cleanupFailed = true }
  }
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') cleanupFailed = true }
    for (let attempt = 0; attempt < 50 && child.exitCode === null && child.signalCode === null; attempt++) await delay(100)
    try {
      process.kill(-child.pid, 0)
      process.kill(-child.pid, 'SIGKILL')
    } catch (error) { if (error.code !== 'ESRCH') cleanupFailed = true }
    let stopped = false
    for (let attempt = 0; attempt < 50; attempt++) {
      try { process.kill(-child.pid, 0) }
      catch (error) { if (error.code === 'ESRCH') stopped = true; break }
      await delay(100)
    }
    if (!stopped) cleanupFailed = true
  }
  if (cleanupFailed) { console.error('CLEANUP FAILED: inspect owned fixture resources'); process.exitCode = 1 }
  else console.log('CLEANUP: owned browser closed, both users deleted, owned memory rows=0, owned Next/Vite stopped')
}
