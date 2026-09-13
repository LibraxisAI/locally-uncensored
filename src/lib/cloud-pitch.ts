/**
 * Was der Wolkenschalter dem Nutzer verspricht, in Zahlen.
 *
 * Bis 3.0.0 war der Schalter ein Schalter ohne Argument: er sagte, dass etwas
 * umgestellt wird, nie, was man dafuer bekommt. Die drei Zeilen unten sind das
 * Argument, in der Reihenfolge, in der es zaehlt: erst was die Modelle duerfen,
 * dann was nichts kostet, dann was die eigene Maschine nicht kann.
 *
 * ## Warum die Zahlen hier fest stehen
 *
 * Der Katalog liegt im Web-Repo. Diese Oberflaeche zeigt die Zahlen, BEVOR
 * jemand angemeldet ist, also bevor es einen Katalog zu lesen gibt. Sie stehen
 * deshalb hier, und `scripts/check-cloud-sales.mjs` haelt jede einzelne gegen
 * ihre Quelle im Web-Repo.
 *
 * Dieses Skript wird VOR DEM RELEASE VON HAND gefahren. Es braucht einen
 * ausgecheckten Web-Baum als Argument und steht deshalb in keinem Workflow und
 * in keinem npm-Skript; niemand darf sich darauf verlassen, dass es eine
 * Abweichung von allein bemerkt. Bei jedem Commit laeuft stattdessen die
 * Reissleine in `__tests__/die-verkaufszahlen-sind-von-hand-gehalten.test.ts`:
 * sie haelt die sieben Zahlen unten gegen ausgeschriebene Werte, damit eine
 * geaenderte Zahl zweimal geaendert werden muss, mit Absicht.
 *
 * Nichts hier ist eine Zusage fuer den Einzelfall. "Ohne Ablehnung" ist eine
 * MESSUNG, kein Vertrag, und was eine Anfrage enthalten darf, entscheidet der
 * Server bei jedem Aufruf neu.
 *
 * ## Die Markenzahl wird gelesen, nicht getippt
 *
 * `unfilteredChatModels` ist die Zahl der Modelle, die die strenge Regel vom
 * 12.09.2026 erfuellen: in BEIDEN Laeufen beide Fragen beantwortet. Sie steht
 * als Zeile in `no-refusals-measurement.md` neben dieser Datei, und der
 * Waechter in `__tests__/die-verkaufszahlen-sind-von-hand-gehalten.test.ts`
 * zaehlt die `full`-Zeilen dieser Datei, statt eine zweite getippte Zahl
 * danebenzustellen. Eine getippte Markenzahl war genau der Fund: sie konnte
 * nicht laut falsch sein. Dasselbe gilt fuer `heldBackChatModels`, das die
 * `partial`-Zeilen derselben Datei zaehlt.
 *
 * ## Zwei Mengen, kein Rueckbezug
 *
 * `unfilteredChatModels` und `flashModels` zaehlen verschiedene Dinge: die
 * einen sind gemessen, die anderen sind eine Abrechnungsklasse. Wie gross ihre
 * Schnittmenge ist, steht nirgends gemessen, also darf keine Zeile sie
 * behaupten. Die zweite Zeile sagte "12 of them" direkt hinter den
 * gemessenen und las sich damit als genau diese Schnittmenge (R6-7). Sie nennt
 * jetzt den Katalog, auf den sich die 12 wirklich beziehen.
 */

export interface CloudPitchNumbers {
  /** Chatmodelle im Katalog. */
  chatModels: number
  /** Davon im Messlauf vom 10.09.2026 dabei. V4.1 Flash kam am selben Tag
   *  nach dem Lauf in den Katalog und traegt bis zur Messung keine Marke. */
  measuredChatModels: number
  /** Davon nach der strengen Regel ohne Ablehnung: `full`-Zeilen in
   *  `no-refusals-measurement.md`. Nur sie tragen die Marke. */
  unfilteredChatModels: number
  /** Davon gemessen mit Zurueckhaltung: sie antworten, gehen aber nicht ganz
   *  mit, und tragen deshalb keine Marke. `partial`-Zeilen derselben Datei. */
  heldBackChatModels: number
  /** Modelle der Flash-Klasse, die im Chat keine Credits kosten. */
  flashModels: number
  /** Taegliche Obergrenze der Flash-Klasse, Ein- und Ausgabe zusammen. */
  flashDailyTokens: number
  /** Bildmodelle. */
  imageModels: number
  /**
   * Videomodelle im Katalog.
   *
   * ACHTUNG, gewollte Abweichung: die Kaufseite auf lu-labs.ai nennt eine
   * KLEINERE Zahl. Sie zaehlt nicht den Katalog, sondern was sie auf dieser
   * Domain zeigen darf: `apps/web/app/(marketing)/pricing/pricing-detail.ts`
   * filtert ueber `keptOffThisDomain` und `CLAIM_IN_NAME`, der Entscheid dazu
   * steht in `apps/web/lib/marketing/public-copy.ts` (10.09.2026). Der Desktop
   * haengt an keiner Zahlungsdomain und nennt deshalb den ganzen Katalog.
   *
   * Beide Zahlen sind je fuer sich bewacht, aber nirgends stand, dass sie
   * absichtlich verschieden sind (R5-47). Ob der Desktop weiter die groessere
   * nennen soll, ist Entscheid David; hier steht nur, dass es kein Versehen
   * ist. `scripts/check-cloud-sales.mjs` haelt diese Zahl gegen die volle
   * Katalogliste, nicht gegen die Kaufseite.
   */
  videoModels: number
  /**
   * Bildmodelle OHNE eingebaute Inhaltsschranke: die `adult: true`-Zeilen mit
   * `kind: 'image'` in `apps/web/lib/render/cloud-models.ts`.
   *
   * Das Flag markiert, was ein Modell KANN, und entscheidet nichts; was
   * durchgeht, entscheidet die Kontoeinstellung beim Absenden. Die Zeile im
   * Verkaufs-Panel sagt deshalb, was im Katalog liegt, und verspricht keinem
   * Konto ein Ergebnis.
   */
  openImageModels: number
  /**
   * Videomodelle ohne eingebaute Inhaltsschranke.
   *
   * Gezaehlt wird, was einen Clip ERZEUGT: `adult: true` mit `kind: 'video'`
   * und ohne `ops`. Das Verlaengerungs-Werkzeug `wan-2.2-spicy-extend` traegt
   * dasselbe Flag, setzt aber einen vorhandenen Clip fort und ist deshalb
   * kein Modell, das man waehlt. Es faellt aus dieser Zahl heraus.
   *
   * ACHTUNG BEIM ZAEHLEN: der Katalog wurde am 13.09.2026 umgebaut. Auf
   * `release/3.0.0` stehen noch sechs, auf dem umgebauten Katalogzweig zehn.
   * Die Zehn ist der Sollwert; `scripts/check-cloud-sales.mjs` zaehlt sie im
   * Web-Repo nach, statt sie zu glauben, und steht so lange rot, bis der
   * Katalog im geprueften Baum nachgezogen ist.
   */
  openVideoModels: number
  /**
   * Der Monatspreis des guenstigsten bezahlten Plans, in Euro.
   *
   * Quelle: `apps/web/lib/pricing.ts`, Eintrag `hosted`. Steht hier, weil der
   * Knopf den Preis nennt, BEVOR jemand angemeldet ist, es also nichts zu
   * lesen gibt. Getippt stand er bis 3.0.0 dreimal in `CloudGateModal.tsx`.
   */
  hostedMonthlyEUR: number
  /** Monatsguthaben desselben Plans. `TIER_CREDITS.hosted` im Web-Repo. */
  hostedCredits: number
}

export const CLOUD_PITCH: CloudPitchNumbers = {
  chatModels: 47,
  measuredChatModels: 46,
  unfilteredChatModels: 24,
  heldBackChatModels: 19,
  flashModels: 12,
  flashDailyTokens: 500_000,
  imageModels: 10,
  videoModels: 11,
  openImageModels: 3,
  openVideoModels: 10,
  hostedMonthlyEUR: 19,
  hostedCredits: 900_000,
}

/**
 * Um wie viel weiter ein Euro auf einem Abo reicht als auf dem besten
 * Guthabenpaket.
 *
 * STEHT HIER ALS ZAHL und nicht als Rechnung, Entscheid vom 13.09.2026: die
 * Paketstufen werden gerade neu gesetzt und gehoeren dem Web-Repo. Ein
 * Desktop, der sie mitfuehrt, haette sie an zwei Orten, und der zweite waere
 * immer der veraltete. Diese Datei fuehrt deshalb KEINE Packgroessen.
 *
 * Gehalten wird die Zahl trotzdem zweifach:
 *
 *   * `__tests__/die-verkaufszahlen-sind-von-hand-gehalten.test.ts` haelt sie
 *     gegen einen ausgeschriebenen Wert. Wer sie aendert, aendert sie zweimal,
 *     und die zweite Aenderung ist die Stelle, an der er es merkt.
 *   * `scripts/check-cloud-sales.mjs` TEILT sie vor jedem Release aus den
 *     lebenden Tabellen des Web-Repos (`TOPUP_PACKS`, `TIER_CREDITS`,
 *     `pricing.ts`) und faellt, wenn sie herausgelaufen ist.
 *
 * Geteilt wird dort gegen das BESTE Paket, damit der Satz untertreibt statt zu
 * schmeicheln: gegen das kleinste waere der Abstand groesser.
 */
export const SUBSCRIBER_CREDIT_FACTOR = 1.5

const n = (v: number) => v.toLocaleString('en-US')

/**
 * Die drei Zeilen, in fester Reihenfolge.
 *
 * Die Reihenfolge ist Absicht und kein Layoutdetail: das Alleinstellungsmerkmal
 * steht zuerst, der Preis danach, die Ausstattung zuletzt. Wer mit der
 * Ausstattung anfaengt, klingt wie jeder andere Anbieter.
 */
export function cloudPitchLines(p: CloudPitchNumbers = CLOUD_PITCH): string[] {
  return [
    `${p.unfilteredChatModels} of the ${p.measuredChatModels} chat models we measured answer without refusing. Measured, not guessed, and marked in the picker.`,
    `${p.flashModels} of the ${p.chatModels} models in the catalogue cost no credits at all in chat, up to ${n(p.flashDailyTokens)} tokens a day on a paid plan.`,
    `${p.chatModels} chat, ${p.imageModels} image and ${p.videoModels} video models on our GPUs, including the ones your own machine cannot run.`,
  ]
}

/**
 * Die drei Zeilen des Verkaufs-Panels, das der Wolkenschalter OHNE Sitzung
 * zeigt (David, 13.09.2026).
 *
 * Kuerzer als `cloudPitchLines` und mit Absicht: der Schalter-Hinweis erklaert
 * einem Benutzer, der schon da ist, was hinter dem Schalter liegt. Diese drei
 * Zeilen stehen vor einem Menschen, der die App zum ersten Mal in die Wolke
 * schieben soll und noch nichts gekauft hat. Drei Zahlen, drei Zeilen, kein
 * Nebensatz.
 *
 * Jede Zahl kommt aus `CLOUD_PITCH`, keine ist getippt.
 */
export function cloudSalesLines(p: CloudPitchNumbers = CLOUD_PITCH): string[] {
  return [
    `${p.unfilteredChatModels} chat models with no refusals`,
    `${p.openVideoModels} uncensored video models`,
    `${p.openImageModels} uncensored image models`,
  ]
}

/** Credits je Euro. Die einzige Kennzahl, die Abo und Paket vergleichbar macht. */
export const HOSTED_CREDITS_PER_EUR =
  CLOUD_PITCH.hostedCredits / CLOUD_PITCH.hostedMonthlyEUR

/**
 * Der Satz unter dem Kaufknopf, an einer Stelle, damit Panel, Versionsblatt,
 * CHANGELOG und der Dialog beim leeren Beutel ihn zeichengleich tragen.
 *
 * Zeichengleich mit dem Web-Repo, wo derselbe Satz aus
 * `apps/web/lib/billing/subscriber-rate.ts` auf vier Oberflaechen steht
 * (Paketkarten, Kontobereich, Dialog beim leeren Beutel, Kaufrueckkehr). Zwei
 * Repos, ein Wortlaut, und auf beiden Seiten aus Konstanten gerechnet.
 *
 * Der Faktor traegt nur, solange ein Paket deutlich unter dem Abo-Kurs liegt.
 * Mit der Pakettabelle vom 10.09.2026 waere er 1,0 gewesen, und der Satz
 * haette nicht geschrieben werden duerfen. Welche Stufen gerade gelten, weiss
 * allein das Web-Repo; `scripts/check-cloud-sales.mjs` rechnet den Faktor vor
 * jedem Release dort nach, statt ihn hier zu glauben.
 */
export const CLOUD_SUBSCRIBER_LINE =
  `Subscribers get about ${SUBSCRIBER_CREDIT_FACTOR.toFixed(1)}x more credits per euro and ${n(CLOUD_PITCH.flashDailyTokens)} free Flash tokens a day.`
