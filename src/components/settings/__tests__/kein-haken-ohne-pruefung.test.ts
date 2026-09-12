/**
 * @vitest-environment jsdom
 *
 * Der gruene Haken sagt etwas ueber eine Pruefung aus. Also steht er erst da,
 * wenn eine Pruefung durchgekommen ist.
 *
 * R2-12 hat den Haken vom FEHLGESCHLAGENEN Versuch getrennt. Der Fall, in dem
 * es gar keinen Versuch gab, blieb: `lastChecked` steht beim Anlauf auf null,
 * bis die erste Pruefung fuenf Sekunden spaeter zurueck ist, und
 * `onRehydrateStorage` setzt es bei jedem Neustart wieder auf null, sobald die
 * gespeicherte Version nicht neuer ist als die laufende. Genau das ist der
 * Normalfall eines Nutzers, der auf dem neuesten Stand ist.
 *
 * T13 hat am 12.09.2026 auf der Windows-Box gemessen, was daran teuer ist: der
 * Satz "You are on the latest version." stand VOR dem Druck auf
 * "Check for updates" da und danach zeichengleich wieder, obwohl die Anfrage
 * dazwischen mit Status 200 in 992 ms beantwortet wurde. Der Nutzer kann an
 * der Anzeige also nicht ablesen, ob jemand nachgesehen hat.
 *
 * Negativkontrolle: gegen den Stand vor dem Fix (der Haken als letzter Zweig,
 * ohne `lastChecked`) sind die ersten beiden Faelle rot.
 *
 * Run: npx vitest run src/components/settings/__tests__/kein-haken-ohne-pruefung.test.ts
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

vi.mock('../../../api/backend', () => ({
  backendCall: vi.fn(async () => ({})),
  isTauri: () => true,
  isMacOS: () => false,
  isLinux: () => false,
  isWindows: () => true,
  openExternal: vi.fn(),
  secretGet: vi.fn().mockRejectedValue(new Error('no keychain here')),
  secretSet: vi.fn(),
  secretDelete: vi.fn(),
}))

const { UpdateSection } = await import('../SettingsPage')
const { useUpdateStore } = await import('../../../stores/updateStore')

async function section(over: Record<string, unknown>) {
  useUpdateStore.setState({
    currentVersion: '3.0.0',
    latestVersion: null,
    updateAvailable: false,
    releaseNotes: null,
    isChecking: false,
    lastChecked: null,
    lastCheckFailed: false,
    dismissed: null,
    downloadStatus: 'idle',
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    errorMessage: null,
    progressNote: null,
    installMethod: null,
    ...over,
  })
  render(createElement(UpdateSection))
  fireEvent.click(screen.getByText('Updates'))
  await act(async () => { await Promise.resolve() })
}

afterEach(cleanup)

describe('der Haken haengt an einer Pruefung', () => {
  it('sagt vor der ersten Pruefung nicht, dass alles aktuell ist', async () => {
    await section({})

    expect(screen.queryByText('You are on the latest version.')).toBeNull()
    expect(screen.getByTestId('update-not-checked')).toBeTruthy()
  })

  it('und sagt es, sobald eine Pruefung durchgekommen ist', async () => {
    await section({ lastChecked: Date.parse('2026-09-12T12:37:46.768Z') })

    expect(screen.getByTestId('update-latest')).toBeTruthy()
    expect(screen.getByText('You are on the latest version.')).toBeTruthy()
    expect(screen.queryByTestId('update-not-checked')).toBeNull()
  })

  // NEGATIVKONTROLLE: der Weg aus R2-12 bleibt, wie er war. Eine
  // fehlgeschlagene Pruefung sagt weiter, dass sie fehlgeschlagen ist, und
  // nicht "noch nicht geprueft".
  it('laesst die gescheiterte Pruefung ihren eigenen Satz behalten', async () => {
    await section({ lastCheckFailed: true })

    expect(screen.getByTestId('update-check-failed')).toBeTruthy()
    expect(screen.queryByTestId('update-not-checked')).toBeNull()
    expect(screen.queryByText('You are on the latest version.')).toBeNull()
  })

  // NEGATIVKONTROLLE: eine gefundene Aktualisierung geht vor. Ohne diesen Fall
  // koennte der Fix oben den Haken durch "Not checked yet." ersetzen und dabei
  // den Update-Kasten mit verdecken.
  it('und zeigt eine gefundene Aktualisierung, egal was lastChecked sagt', async () => {
    await section({ updateAvailable: true, latestVersion: '3.0.1', lastChecked: null })

    expect(screen.getByText('Update available!')).toBeTruthy()
    expect(screen.queryByTestId('update-not-checked')).toBeNull()
  })
})
