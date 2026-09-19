/**
 * Einen Platz auf der Spur nehmen, den Lauf fahren, den Platz zurueckgeben.
 * An EINER Stelle.
 *
 * ── WARUM DAS NICHT JEDER SELBST MACHT ──────────────────────────────────────
 *
 * `run-lanes.ts` schreibt die Pflicht in seinen Kopf, in Grossbuchstaben: wer
 * `'started'` bekommt, MUSS `release` mit derselben Kennung rufen, im
 * `finally`, auch bei Fehler und Abbruch. Ein nicht zurueckgegebener Platz
 * haelt die lokale Spur fuer den Rest der Sitzung besetzt; jeder weitere
 * lokale Lauf reiht sich dann in eine Schlange ein, die nie wieder
 * abgearbeitet wird. Das ist die einzige Art, wie die Spur die App zum Stehen
 * bringen kann.
 *
 * Eine Pflicht, die an jeder Aufrufstelle neu eingehalten werden muss, wird
 * irgendwann an einer Aufrufstelle nicht eingehalten, und zwar nicht durch
 * Nachlaessigkeit: die Sendewege im Haus sind lang, haben mehrere
 * Fehlerpfade, ein `return` mittendrin und Abbruchbehandlung an drei Stellen.
 * Wer dort ein `finally` uebersieht, sieht nichts Rotes. Er sieht ein
 * funktionierendes Programm, bis der zweite lokale Lauf kommt.
 *
 * Deshalb gibt der Aufrufer hier seinen RUMPF ab statt eine Zusicherung. Das
 * `finally` steht dann genau einmal im Haus, und ein Waechter
 * (`__tests__/run-slot.test.ts`) haelt fest, dass `admit` und `release` sonst
 * nirgends geholt werden.
 *
 * ── WAS HIER SONST NOCH HINEINGEHOERT, UND WARUM ────────────────────────────
 *
 * Der Abbruchgriff wird SCHON BEIM ANSTELLEN gesetzt, nicht erst wenn der
 * Lauf anlaeuft. Sonst haette Stop an einem wartenden Lauf nichts zu greifen:
 * der Rumpf, der den Griff sonst registriert, hat ja noch nicht angefangen.
 * Der Nutzer sieht ein Warteplaettchen, drueckt Stop, und nichts passiert.
 *
 * ── ES GIBT KEINEN WIEDEREINTRITTS-FASTPATH MEHR, UND DAS IST ABSICHT ───────
 *
 * (Blocker A, Opus-Review Runde 2) Bis hierher gab es einen zweiten Weg neben
 * `admit`/`release`: rief `runInLane` fuer eine `conversationId` an, fuer die
 * schon ein Lauf "in diesem Modul steckte" (ein Zaehler `tiefe`), lief der
 * Rumpf sofort durch, ohne Platz, ohne Buchung, ohne Anstellen. Gedacht war
 * das fuer einen Vordergrund-Sub-Agenten, der sonst auf die Spur seines
 * eigenen Elternlaufs gewartet haette (`sub-agent.ts: return await
 * runner(...)`).
 *
 * Zwei Dinge waren daran falsch. Erstens gibt es diesen Aufrufer heute gar
 * nicht mehr: `sub-agent.ts` ruft `provider.chatWithTools` beziehungsweise
 * `registry.execute` direkt, nie `runInLane` (nachgesehen per grep ueber
 * `src/api` und `src/lib`, kein Treffer). Zweitens traf der Fastpath nicht
 * nur einen echten verschachtelten Aufruf, sondern JEDEN zweiten Aufruf mit
 * derselben `conversationId`, auch einen, der mit dem ersten nichts zu tun
 * hat: Stop in einer Unterhaltung, sofort danach neu gesendet. Der ALTE Lauf
 * wickelt sich noch ab (`endTurnDurably` braucht gemessen 300 bis 500 ms),
 * sein eigenes `finally` hat die Spur noch nicht zurueckgegeben, und der NEUE
 * Lauf traegt dieselbe `conversationId`. Der Fastpath liess ihn durch, ohne
 * Platz zu nehmen, und wenn der ALTE Lauf danach seinen Platz zurueckgab,
 * rueckte ein dritter, wirklich wartender Lauf nach, WAEHREND der neue Lauf
 * noch ungebucht gegen den Motor lief: zwei echte Anfragen gleichzeitig,
 * gemessen mit einem Wegwerf-Test gegen dieses Modul, Zahlen im Baubericht.
 *
 * Die richtige Antwort ist nicht ein besserer Zaehler, sondern die Frage
 * anders zu stellen: nicht "traegt dieser Aufruf dieselbe `conversationId`",
 * sondern "ist das WIRKLICH derselbe Lauf". Das beantwortet jetzt eine
 * eigene Identitaet je `runInLane`-Aufruf (`identity` unten), die an
 * `admit`/`release` weitergereicht wird (siehe deren Kopf in `run-lanes.ts`).
 * Ein neuer Lauf derselben Unterhaltung bekommt eine NEUE Identitaet und
 * stellt sich damit hinter dem noch abwickelnden alten an, statt ihn zu
 * ersetzen.
 *
 * ── DIE WEITERGABE DES ELTERNLAUF-TOKENS, JETZT WIRKLICH GEBAUT ─────────────
 *
 * (Nachbesserung 3, Runde 3 der 3.0.1-Pruefung) Ein echter verschachtelter
 * Aufrufer ist inzwischen da, gleich zwei: `workflow-engine.ts`s eigener
 * `run_workflow`-Aufruf (`api/mcp/builtin-tools.ts`, verschachtelt in einen
 * schon laufenden Werkzeugaufruf) und der VORDERGRUND-Sub-Agent
 * (`sub-agent.ts`, `return await runner(...)`, der Elternzug wartet auf ihn).
 * Beide reichen ihr Elternlauf-Token jetzt EXPLIZIT weiter, ueber
 * `runsInHeldLane` unten, statt es stillschweigend ueber die blosse
 * `conversationId` erschliessen zu lassen: wer es setzt, ruft `admit`/`release`
 * gar nicht auf, sondern fuehrt seinen Rumpf direkt im schon gebuchten Platz
 * des Elternlaufs aus. Kein zweites `admit` mit gleicher oder neuer Identitaet
 * fuer dieselbe `conversationId`, denn ein ABGEWARTETES `runInLane`
 * verschachtelt in einem anderen haengt hart: der innere Aufruf stellt sich
 * hinter dem aeusseren an, der aeussere wartet auf den inneren, beide fuer
 * immer (gemessen, siehe `__tests__/run-slot-nested-in-held-lane.test.ts`).
 * `runsInHeldLane` ist der einzige Weg, das zu vermeiden, und er ist ein
 * bewusster Parameter, kein aus der `conversationId` erratener Zustand.
 *
 * Der HINTERGRUND-Sub-Agent (`sub-agent.ts`, `void runner(...)`) ist die
 * Gegenprobe: er wird vom Elternzug NICHT abgewartet, ueberlebt dessen Ende
 * und braucht deshalb seine EIGENE Buchung unter einer eigenen Identitaet
 * (die Aufgaben-Id, nicht die `conversationId` der sichtbaren Unterhaltung),
 * damit `stopAllBackgroundWork` ihn erreicht und er sich in dieselbe lokale
 * Spur einreiht wie jeder andere Lauf. `runsInHeldLane` bleibt fuer ihn
 * `false` (der Vorgabewert).
 */
import { admit, release, type RunLane } from './run-lanes'
import { useGenerationStore } from '../stores/generationStore'

export interface RunSlotOptions {
  /** Der sichtbare Lauf. Dieselbe Kennung, die der Stop-Knopf benennt. */
  conversationId: string
  /** Eigene Karte oder fremde Kapazitaet: `laneOf(model, currentLaneFacts())`. */
  lane: RunLane
  /**
   * Abbrechen, waehrend der Rumpf schon laeuft.
   *
   * Optional, weil die Sendewege ihren eigenen Griff registrieren, sobald sie
   * ihren `AbortController` haben; der ueberschreibt den hiesigen dann. Fuer
   * die Zeit davor, also das Warten in der Schlange, sorgt dieses Modul
   * selbst: dort wird nichts abgebrochen, sondern ausgereiht.
   */
  abort?: () => void
  /**
   * Dieser Rumpf laeuft bereits IM gebuchten Platz eines Elternlaufs
   * (verschachteltes `run_workflow` oder ein vorgroundlicher Sub-Agent, den
   * sein Elternzug abwartet). Siehe Dateikopf, Abschnitt "DIE WEITERGABE DES
   * ELTERNLAUF-TOKENS". Gesetzt, ruft diese Funktion `admit`/`release`
   * ueberhaupt nicht auf: sie fuehrt `body()` direkt aus. Ein zweites `admit`
   * fuer dieselbe `conversationId` waere hier eine Verklemmung, kein
   * Doppelbuchen, denn der aeussere Lauf wartet ja SELBST auf diesen inneren.
   * Vorgabe `false`: ein eigenstaendiger Lauf bucht immer selbst.
   */
  runsInHeldLane?: boolean
}

/**
 * Wie der Lauf ausging, aus Sicht der Spur.
 *
 * `'cancelled-while-queued'` heisst: der Rumpf hat NIE angefangen. Kein
 * Token, keine Antwort, nichts aufzuraeumen. Wer davor schon etwas in den
 * Chat geschrieben hat, muss das selbst wieder wegnehmen; hier ist nichts
 * passiert, was zurueckzunehmen waere.
 */
export type RunSlotOutcome = 'ran' | 'cancelled-while-queued'

/** Warum das Warten zu Ende ist: drangekommen, oder vorher abgesagt. */
type Weckgrund = 'drangekommen' | 'ausgereiht'

/**
 * Den Lauf fahren, sobald seine Spur frei ist.
 *
 * Cloud faengt sofort an. Lokal faengt sofort an, wenn die Karte frei ist,
 * und stellt sich sonst an; der Rumpf laeuft dann an, wenn der Vordermann
 * fertig ist. Der Rueckgabewert sagt, ob er ueberhaupt gelaufen ist.
 *
 * Fehler aus dem Rumpf kommen unveraendert heraus. Dieses Modul faengt
 * nichts: es entscheidet nur, WANN gelaufen wird, und raeumt danach auf.
 */
export async function runInLane(
  options: RunSlotOptions,
  body: () => Promise<void>,
): Promise<RunSlotOutcome> {
  const { conversationId, lane, abort, runsInHeldLane } = options

  // Laeuft dieser Rumpf schon im Platz eines Elternlaufs, gibt es hier
  // nichts anzustellen: kein `admit`, kein `release`, keine eigene
  // Buchung. Ein zweites `admit` fuer dieselbe `conversationId` waere die
  // Verklemmung aus dem Dateikopf, weil der aeussere Lauf auf genau diesen
  // Rumpf wartet. Fehler kommen unveraendert heraus, wie beim normalen Weg.
  if (runsInHeldLane) {
    await body()
    return 'ran'
  }

  // Ein Lauf ohne Kennung nimmt keinen Platz, dieselbe Entscheidung wie in
  // `admit`: er koennte ihn nie zurueckgeben, weil `release` ihn ueber genau
  // diese Kennung findet. Zwei lokale Laeufe nebeneinander sind langsam, eine
  // fuer immer besetzte Spur ist tot.
  if (!conversationId) {
    await body()
    return 'ran'
  }

  // Die eigene Identitaet DIESES Aufrufs, siehe Kopf ("ES GIBT KEINEN
  // WIEDEREINTRITTS-FASTPATH MEHR"). Ein frisches Objekt, mit nichts als sich
  // selbst vergleichbar: zwei Aufrufe mit derselben `conversationId` sind
  // damit fuer `admit`/`release` zwei verschiedene Laeufe, es sei denn,
  // jemand reicht ausdruecklich dieselbe `identity` weiter. Niemand tut das
  // heute; kommt so ein Aufrufer zurueck, ist das die einzige Stelle, die er
  // aendern muss.
  const identity = Symbol(conversationId)

  let zustand: 'wartend' | 'laeuft' | 'ausgereiht' = 'wartend'
  let wecken: ((grund: Weckgrund) => void) | null = null

  /**
   * Stop, aus Sicht dieses Laufs.
   *
   * Zwei voellig verschiedene Dinge, je nachdem wo der Lauf steht, und genau
   * deshalb steht der Griff hier und nicht im Rumpf: waehrend des Wartens
   * gibt es keinen Strom zum Abbrechen, es gibt eine Zeile in einer
   * Schlange, die verschwinden muss. Bliebe sie stehen, bekaeme sie spaeter
   * die Karte fuer einen Lauf, den der Nutzer laengst abgesagt hat.
   */
  const abbruchgriff = (): void => {
    if (zustand === 'wartend') {
      zustand = 'ausgereiht'
      // `release` auf einen Wartenden nimmt ihn aus der Schlange und rueckt
      // NIEMANDEN nach, denn der Halter rechnet ja weiter.
      release(conversationId, identity)
      wecken?.('ausgereiht')
      return
    }
    abort?.()
  }

  const store = useGenerationStore.getState()
  store.registerAborter(conversationId, abbruchgriff)
  store.bookRun(conversationId, lane, identity)

  const urteil = admit(lane, conversationId, () => {
    // Der Vordermann ist fertig. Dieser Aufruf WECKT nur; der Rumpf laeuft
    // erst im naechsten Mikrotask, also ausserhalb des `finally` des
    // vorigen Laufs. Genau darum darf `release` seinen Rueckgabewert weiter
    // unten im `finally` gerufen werden, ohne die beiden Laeufe zu
    // verbinden: ein Fehler des Nachrueckenden kann hier nicht entstehen.
    if (zustand !== 'wartend') return
    zustand = 'laeuft'
    wecken?.('drangekommen')
  }, identity)

  // Warum das Wecken seinen Grund mittraegt, statt dass hier `zustand`
  // gelesen wird: `zustand` wird ausschliesslich in Rueckrufen gesetzt, und
  // die sieht der Fluss dieser Funktion nicht. Der Uebersetzer haelt die
  // Zuweisungen fuer unerreichbar und die Abfrage danach fuer sinnlos
  // (TS2367, "no overlap"). Er hat recht mit dem, was er sieht; die Antwort
  // ist, sie ihm mitzugeben, statt ihn zu ueberstimmen.
  let grund: Weckgrund = 'drangekommen'
  if (urteil === 'started') {
    zustand = 'laeuft'
  } else {
    grund = await new Promise<Weckgrund>((aufloesen) => {
      // Zwischen `admit` und hier liegt kein `await`, der Startaufruf kann
      // also noch nicht gefallen sein. Die Abfrage steht trotzdem da: sie
      // kostet nichts und haelt den Fall aus, dass jemand die Reihenfolge
      // spaeter umbaut.
      if (zustand === 'ausgereiht') { aufloesen('ausgereiht'); return }
      if (zustand === 'laeuft') { aufloesen('drangekommen'); return }
      wecken = aufloesen
    })
  }

  if (grund === 'ausgereiht') {
    aufraeumen(conversationId, abbruchgriff, identity)
    return 'cancelled-while-queued'
  }

  try {
    await body()
    return 'ran'
  } finally {
    aufraeumen(conversationId, abbruchgriff, identity)
    // DIE PFLICHT AUS DEM KOPF VON run-lanes.ts, an ihrer einzigen Stelle.
    // Der Platz ist beim Zurueckkehren aus `release` schon an den Naechsten
    // vergeben; wer den Rueckgabewert verwirft, laesst die Spur haengen.
    release(conversationId, identity)?.()
  }
}

/**
 * Buchung weg, eigener Abbruchgriff weg.
 *
 * Beides nur, wenn es noch UNSERES ist (`identity`). Der Sendeweg
 * registriert im Rumpf seinen eigenen Abbruchgriff und ueberschreibt diesen
 * dabei; ihn danach blind wegzuraeumen, naehme dem Nutzer den Stop-Knopf fuer
 * einen Lauf, der noch ausrollt. Dieselbe Frage gilt seit Blocker A fuer die
 * Buchung selbst: ein spaet kommendes `finally` eines abgeloesten Laufs
 * (Stop, sofort neu gesendet) darf `generationStore.runs` nicht loeschen,
 * wenn der NEUE Lauf die Unterhaltung inzwischen uebernommen hat.
 */
function aufraeumen(conversationId: string, eigenerGriff: () => void, identity: unknown): void {
  const store = useGenerationStore.getState()
  store.endRun(conversationId, identity)
  if (useGenerationStore.getState().aborters[conversationId] === eigenerGriff) {
    store.clearAborter(conversationId)
  }
}
