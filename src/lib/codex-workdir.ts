/**
 * Where the Coding Agent actually works, and when that may be changed.
 *
 * Both halves used to live inline in useCodex and in the two views, which is
 * how A8 (2.6.8) got as far as it did: the precedence was a three-line boolean
 * chain nobody could test, and "is a run in flight" was a different expression
 * on every surface. They are pure functions here, with the tests next to them.
 */
import { isActiveCodexStatus, type CodexThreadStatus } from '../types/codex'

export interface CodexWorkDirInput {
  /** The folder pinned on this conversation's thread. */
  threadDir: string | null | undefined
  /** Per-chat agent workspace, or settings.defaultWorkspace, when folder-kind. */
  workspacePath: string | null | undefined
  /** The folder the Code tab's picker currently shows. */
  storeDir: string | null | undefined
}

/** The bridge's per-chat sandbox under ~/agent-workspace. */
export const CODEX_SANDBOX = '.'

/**
 * Precedence, unchanged from the inline version it replaces:
 *   1. the thread's own folder (the picker value, synced at every send)
 *   2. the resolved agent workspace, when it names a real folder
 *   3. the picker value again, for a thread that has not been synced yet
 *   4. the per-chat sandbox
 *
 * A thread carrying the literal '.' does NOT count as a pick. It is what
 * `initThread` writes when there is no folder, and treating it as one used to
 * hide a per-chat workspace behind a placeholder.
 */
export function resolveCodexWorkDir({
  threadDir,
  workspacePath,
  storeDir,
}: CodexWorkDirInput): string {
  const fromThread = threadDir && threadDir !== CODEX_SANDBOX ? threadDir : null
  return fromThread || workspacePath || storeDir || CODEX_SANDBOX
}

/**
 * What the agent falls back to when the picker is empty, in the words the user
 * needs. The empty state used to promise "~/agent-workspace" flat out, which is
 * a lie for anybody who set a default workspace in Settings or pinned a folder
 * on this chat: those win over an empty picker (see the precedence above).
 */
export function codexFallbackLabel(workspacePath: string | null | undefined): string {
  return workspacePath || '~/agent-workspace'
}

/**
 * Why the working directory is held right now, or null when it is free.
 *
 * 'run'  a coding turn is in flight, from the moment the send starts.
 * 'loop' a /loop is standing between two passes: the thread says idle, the
 *        next pass is on a timer, and moving the folder under it would send
 *        that pass somewhere else without anybody watching.
 */
export type CodexBusyReason = 'run' | 'loop'

export interface CodexBusyInput {
  /**
   * Sends that have started and not yet finished. Counted synchronously at the
   * top of sendInstruction: the thread status only flips to 'running' after
   * five awaits (workspace slug, tool support, token budget, memory, rules),
   * and the whole gap was unlocked before.
   */
  sendsInFlight: number
  /** codexStore.threads, for a turn that is past those awaits. */
  threads: Record<string, { status: CodexThreadStatus }>
  /**
   * generationStore.generating, as the PROOF that a thread's status is about a
   * run that is still alive. See below.
   */
  generating: Record<string, boolean>
  /** agentLoopStore.loop, or null when no /loop is standing. */
  loop: unknown | null
}

/**
 * Only Coding Agent signals count. The first cut read every conversation's
 * generating flag, so a streaming Chat tab in another conversation locked the
 * folder picker on Code for no reason at all.
 *
 * ── WARUM DIE FAHNE DAZUGEHOERT ──────────────────────────────────────────
 * Ein Faden bleibt auf 'running' stehen, bis der Lauf sich abgewickelt hat.
 * `stopCodex` raeumt die Erzeugungsfahne SOFORT (`abortConversation`), der
 * Status kommt erst im `finally` des Laufs zurueck auf 'idle', und ein
 * Shell-Befehl, der das Signal nicht beachtet, dehnt dieses Fenster beliebig
 * weit. Solange es offen stand, waren beide Ordnerknoepfe tot, und der Grund
 * hing als `title` an einem `disabled` Knopf, der keine Mauszeiger-Ereignisse
 * annimmt, also nie erschienen ist. Fuer den Nutzer war der Ordner damit ohne
 * Vorwarnung und ohne Ausweg gesperrt.
 *
 * Der Status allein ist also kein Beweis, dass etwas laeuft, und genau das ist
 * der Fehler, gegen den `lib/run-idle.ts` fuer die ganze App geschrieben
 * wurde: zwei Quellen, und keine von beiden ist fuer sich die Wahrheit. Hier
 * ist es dieselbe Versoehnung, nur pro Gespraech und ohne Speicherzugriff, weil
 * diese Funktion rein bleibt und ihre Aufrufer beide Karten ohnehin
 * abonnieren.
 *
 * `isActiveCodexStatus` statt `=== 'running'`: die Wartefreigabe und das
 * Schreiben der abgelegten Aenderungen sind genauso laufende Arbeit, und der
 * Vergleich von Hand war der stille `else`, den AS-08 beschreibt.
 *
 * Gesperrt bleibt damit genau ein Lauf, der wirklich noch laeuft. Der Weg
 * heraus ist der Stopp-Knopf, den der Lauf ohnehin hat: er raeumt die Fahne,
 * und der Ordner ist im selben Augenblick wieder frei.
 */
export function codexBusyReason({ sendsInFlight, threads, generating, loop }: CodexBusyInput): CodexBusyReason | null {
  if (sendsInFlight > 0) return 'run'
  const alive = Object.entries(threads).some(
    ([convId, t]) => isActiveCodexStatus(t.status) && generating[convId] === true,
  )
  if (alive) return 'run'
  if (loop) return 'loop'
  return null
}

/**
 * One sentence per reason, so the two buttons cannot drift apart. Both name a
 * way out: a disabled button cannot be waited out blindly, and a run whose
 * tail hangs would otherwise hold the folder for the rest of the session.
 */
export const CODEX_WORKDIR_LOCK_TITLE: Record<CodexBusyReason, string> = {
  run: 'A coding run is in flight. Wait for it to finish or press Stop, then you can change the folder.',
  loop: 'A loop is still running. Stop it first, then you can change the folder.',
}
