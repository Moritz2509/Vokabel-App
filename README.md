# 🗣️ Vokabeltrainer

Eine Vokabel-App wie Quizlet, mit zwei Besonderheiten: Du **sprichst deine Vokabeln einfach ein**, und ein
**Spaced-Repetition-Algorithmus** sorgt dafür, dass du schwierige Wörter oft und gut gekonnte nur noch selten abgefragt bekommst.

## Funktionen

- **Vokabeln einsprechen** 🎤: Auf das Mikrofon tippen, Wort sagen. Danach hört die App automatisch auf die Übersetzung.
  Hat die Spracherkennung dich falsch verstanden, kannst du per Tipp eine andere erkannte Variante wählen.
- **Diktiermodus**: Ganz freihändig. Wort sagen, Übersetzung sagen, gespeichert, nächstes Wort. Mit „Stopp“ beendest du ihn.
- **Liste einfügen**: z. B. `Hund = dog`, eine Vokabel pro Zeile.
- **Lernmodi**
  - **Lernen** (wie bei Quizlet): Neue Wörter wählst du zuerst aus 4 Antworten aus. Danach musst du sie selbst sagen oder tippen.
  - **Antworten**: Antwort **einsprechen** oder tippen. Kleine Tippfehler, Artikel („der“, „the“) und Großschreibung werden toleriert.
  - **Karteikarten**: Umdrehen und selbst bewerten (Nochmal / Schwer / Gut / Leicht).
  - **Multiple Choice**
  - Richtung wählbar: A → B, B → A oder gemischt.
- **Vorlesen** 🔊 jeder Vokabel in der richtigen Sprache.
- **Freihändig lernen** (Einstellungen): Das Wort wird vorgelesen, das Mikrofon startet von selbst, und bei einer richtigen Antwort geht es automatisch weiter.
- Lernstand pro Vokabel (Neu, Am Lernen, Sitzt fast, Gemeistert), Tagesserie 🔥, Statistik.
- Funktioniert offline und lässt sich auf dem Handy als App installieren („Zum Home-Bildschirm hinzufügen“).
- Sicherung als JSON-Datei exportieren und wieder importieren.

## So funktioniert der Algorithmus

Jede Vokabel hat einen eigenen Lernstand (angelehnt an SM-2, den Algorithmus hinter Anki/SuperMemo):

| Du weißt das Wort … | Was passiert |
|---|---|
| **nicht** | Es kommt in derselben Runde nach 3 anderen Karten **nochmal**, so lange, bis du es kannst. Die Wiederholungsabstände fangen wieder klein an, und das Wort gilt danach als „schwerer“. |
| **mit Mühe** | Es kommt bald wieder. Der Abstand wächst nur wenig. |
| **gut** | Der Abstand bis zur nächsten Abfrage wächst: 1 Tag → 3 Tage → ~1 Woche → ~3 Wochen → … |
| **leicht** | Der Abstand wächst noch schneller. |

Mit **„Lernen“** bekommst du nur die Karten, die gerade fällig sind, plus einige neue (einstellbar).
Mit **„Alle üben“** übst du alle Karten, die schwächsten zuerst. Dabei werden nur Fehler im Lernplan gespeichert.

## Starten

Die App ist eine reine Web-App ohne Server und ohne Abhängigkeiten. Alle Daten bleiben im Browser auf deinem Gerät.

**Online (empfohlen, auch fürs Handy):** Das Repository bringt einen GitHub-Pages-Workflow mit.
Einmal unter *Settings → Pages → Source* „**GitHub Actions**“ auswählen. Nach jedem Push auf `main`
ist die App dann unter `https://<benutzername>.github.io/<repo>/` erreichbar.

**Lokal:**

```bash
npm start          # startet einen kleinen Server auf http://localhost:8080
npm test           # Tests für Algorithmus und Antwortprüfung
```

> **Hinweis zur Spracheingabe:** Sie nutzt die Web Speech API und läuft in **Chrome, Edge und Safari**
> (auch auf iPhone/Android), aber nicht in Firefox. Der Browser braucht HTTPS (oder `localhost`) und
> Mikrofon-Freigabe. In Chrome läuft die Erkennung über Googles Server, deshalb braucht sie Internet.

## Aufbau

```
index.html           Einstiegsseite
css/style.css        Design (hell/dunkel)
js/app.js            Oberfläche & Ansichten
js/srs.js            Spaced-Repetition-Algorithmus & Lernrunde
js/compare.js        Tolerante Antwortprüfung (Tippfehler, Artikel, mehrere Lösungen)
js/speech.js         Spracherkennung & Vorlesen
js/store.js          Speicherung (localStorage), Import/Export
sw.js                Offline-Unterstützung
tests/               Tests (node --test)
```
