# Mock-Wuensche Bereich misc (cloud, agents, personas, ui, workflows)

Stand 2026-08-20, Welle 3. Keiner dieser Punkte hat ein Element blockiert,
alle 45 Elemente waren mit dem vorhandenen Mock erreichbar. Die Liste ist
Aufraeumarbeit fuer den Dirigenten, damit die naechste Welle es kuerzer hat.

## 1. Ein umschaltbares Konto in cloud-mock.ts

`routeCloud(page, scenario)` friert das Szenario beim Aufruf ein. Genau das
kann man aber fuer die vier "Check again"-Knoepfe im Cloud-Tor nicht
gebrauchen: der ganze Sinn dieser Knoepfe ist, dass der Server zwischen zwei
Klicks etwas anderes sagt. Ich habe das geloest, indem
`e2e/cloud-account-gate.spec.ts` eigene Routen fuer `/api/me` und
`/api/jobs/quota` NACH `routeCloud` registriert und aus einer veraenderbaren
Box beantwortet (Playwright nimmt die zuletzt registrierte Route zuerst).

Wunsch: dieselbe Box zentral, etwa

    const account = await routeCloudMutable(page, { license: 'none', access: true, credits: 0 })
    account.set({ license: 'active', access: true, credits: 2_550_000 })

Zwei Fallen fuer den Einbau, beide in meinem Spec schon geloest:

- Der Zustand "Verbrauch nicht ladbar" (quota null) entsteht NUR bei 401 oder
  403 auf `/api/jobs/quota`. Bei jedem anderen Fehler behaelt `probeAccount`
  bewusst die letzte bekannte Quota, dann steht das Tor nie in diesem Zweig.
- Nach dem Klick muss der Test auf die Antworten warten UND danach der
  Sondierung einen Tick geben. Ohne diese Schranke laufen zwei Sondierungen
  ineinander, die neue Quota trifft auf die alte Lizenz, das Tor schliesst
  unter dem Knopf weg und der naechste Klick landet auf einem abgehaengten
  Knoten. Siehe `recheck()` im Spec.

## 2. Ein stabiler Anmeldeweg durch das Tor

`signInViaGate` in cloud-mock.ts klickt drei Mal blind (intro, plans, login).
Unter Last geht ein Klick verloren, der waehrend der Einblend-Animation des
Dialogs faellt, und der Test wartet danach ewig auf einen Knopf, der nie
wiederkommt. Ich habe `signInViaGateStable` in
`e2e/support/journeys/misc.ts` gebaut: ein Schritt weniger (intro direkt zur
Anmeldung) und eine Wiederholung nach dem Muster, das
`e2e/support/ui.ts:openNewChat` fuer New Chat schon faehrt. Gehoert
mittelfristig in cloud-mock.ts, dann koennen alle Specs es nutzen.

## 3. Installierte ComfyUI-Modelle als Option

Der Reiter "Models" im Dialog Workflows & tags zeigt nur Modelle mit
`providerName === 'ComfyUI'`. Auf der frischen Box gibt es keine, also ist
diese Haelfte des Dialogs (inklusive der Modell-Tags) e2e nicht erreichbar.
Ich bin fuer `workflows.tag-picker.toggle-tag` ueber den Import-Weg gegangen
(API-JSON einfuegen, dann den Chip an der Workflow-Karte schalten), das
reicht fuer den Chip. Fuer `setModelTags` und die Paarung Modell zu Workflow
braeuchte die naechste Welle eine Mock-Option mit ein paar ComfyUI-Modellen.

## 4. Kein Wunsch, aber eine Warnung fuer den Dirigenten

Die drei Fehlschlaege, die ich in dieser Welle gesehen habe, waren KEINE
App-Fehler und keine Mock-Luecken: der Vite-Dev-Server auf 5173 ist geteilt,
und waehrend meine Tests liefen, haben andere Agenten `Composer.tsx`,
`Header.tsx` und `SettingsPage.tsx` gespeichert. Der Hot-Reload tauscht die
Module mitten im Test, die Zustand-Stores werden dabei neu angelegt, offene
Dialoge verschwinden ohne dass ihr Schliessen-Pfad lief, und Playwright
meldet "element is not stable" oder "detached from the DOM". Wer eine
gruene Wellenlaufzeit braucht, laesst die Specs eines Bereichs laufen,
waehrend niemand sonst an `src/` schreibt. Alle 25 Tests sind in einem Lauf
ohne fremde Schreibzugriffe gruen.
