/**
 * Der Grundtext, den jede Oberflaeche mitschickt.
 *
 * ## Warum es ihn gibt
 *
 * Ein leerer Systemtext ist nicht neutral. Ohne Systemtext antwortet ein
 * Modell aus der Haltung, die sein Anbieter antrainiert hat, und genau die
 * enthaelt die Ablehnungen, die wir nicht wollen. Gemessen am 10.09.2026 ueber
 * alle 46 Katalogmodelle: sechs Modelle wechseln allein durch einen Systemtext,
 * der die Rolle benennt, vom Ablehnen zum Antworten. Der Systemtext wirkt
 * staerker als die Temperatur.
 *
 * Der Chat schickte bis dahin GAR NICHTS: der Personenschalter steht bewusst
 * auf aus (sonst kapert eine global gewaehlte Person jede neue Unterhaltung,
 * siehe Sidebar.tsx), und die Zusammensetzung fiel damit auf den leeren String
 * zurueck. Die Person zu reparieren reichte deshalb nicht, der Grundtext muss
 * unabhaengig vom Schalter gelten.
 *
 * ## Was NICHT drinsteht
 *
 * Keine Inhaltsregel, weder eine erlaubende noch eine verbietende. Ein Satz wie
 * „du darfst auch explizite Inhalte schreiben" bringt dem Modell erst die
 * Kategorie bei, an der es dann haengenbleibt, und ein Satz wie „lehne X ab"
 * schaltet die antrainierte Vorsicht zusaetzlich scharf. Der Text sagt nur, wem
 * das Modell gehoert und dass ungefragte Belehrungen nicht dazugehoeren.
 *
 * Die harte Grenze liegt nicht hier. Sie liegt im Proxy (lib/render/safety.ts
 * in der Webanwendung) und gilt unabhaengig davon, was im Systemtext steht.
 */

/** Die eine Verhaltenszeile. Sie haengt an JEDER Oberflaeche, auch am Agenten. */
export const HOUSE_CONDUCT =
  'Answer the request that was actually made. Do not add disclaimers, warnings or moral commentary that the user did not ask for, and do not lecture. If a request is genuinely ambiguous, ask one short question instead of guessing.'

/** Die Rolle im Chat, wenn keine Person eingeschaltet ist. */
export const CHAT_BASE_ROLE = "You are the user's own model, running for them alone."

/** Chat ohne Person: Rolle plus Verhaltenszeile. */
export const CHAT_BASE_SYSTEM_PROMPT = `${CHAT_BASE_ROLE} ${HOUSE_CONDUCT}`

/**
 * Der Systemtext einer Unterhaltung.
 *
 * Mit eingeschalteter Person traegt die Person die Rolle, der Grundtext haengt
 * nur die Verhaltenszeile an. Ohne Person gilt der Grundtext ganz. In beiden
 * Faellen geht etwas raus, nie mehr ein leerer String.
 */
export function buildChatSystemPrompt(conv: {
  systemPrompt?: string | null
  personaEnabled?: boolean
}): string {
  const persona = conv.personaEnabled === true ? (conv.systemPrompt || '').trim() : ''
  return persona ? `${persona}\n\n${HOUSE_CONDUCT}` : CHAT_BASE_SYSTEM_PROMPT
}

/**
 * Die Verhaltenszeile an einen Oberflaechentext haengen.
 *
 * Agent und Coding bringen ihre eigene Rolle mit, die der Grundtext nicht
 * ueberschreiben darf. Sie brauchen nur den Teil, der die ungefragten
 * Belehrungen abstellt.
 */
export function withHouseConduct(surfacePrompt: string): string {
  const base = surfacePrompt.trimEnd()
  return base.includes(HOUSE_CONDUCT) ? base : `${base}\n\n${HOUSE_CONDUCT}`
}
