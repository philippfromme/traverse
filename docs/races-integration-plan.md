# Rennplanung und Saisonübersicht in Traverse

Status: Die drei Umsetzungsschritte sind implementiert; dieser Plan dokumentiert den Entwurf. Nutzung und Prüfungen stehen in der README unter „Races“. Stand: 19.10.2026.

## Ziel

Die Ansicht [Running Season 2027](https://running-season-2027.philippfromme.chatgpt.site/) wird als native Traverse-Seite `/races` integriert. Wie in der vom Nutzer genannten Garmin-Connect-Funktion lassen sich eigene Rennen hinzufügen und für die Vorbereitung auswählen. Die Seite funktioniert für beliebige Jahre und Rennen; 2027 ist ein erster Anwendungsfall.

Die Garmin-Connect-Analogie beschreibt die Bedienung. Ein Import oder eine Synchronisierung von Garmin-Rennterminen gehört zunächst nicht zum Umfang. Traverse bleibt ein selbst gehosteter Viewer mit eigener Planungsverwaltung.

## Geprüfter Ausgangspunkt

Die veröffentlichte Referenz (Sites-Projekt `appgprj_6ad532ea200c8191a67aac3e058f682f`, Version 8) zeigt:

- Nächstes Rennen mit Countdown, vierwöchigen Kilometerdurchschnitt, letzte Laufwoche, längsten Lauf und achtwöchigen Verlauf.
- Eine Saisonzeitleiste mit Rennen und den Phasen Grundlage, Aufbau, Rennspezifisch und Reduzieren.
- Ein ausgewähltes Trainingsziel, Hinweise auf nahe beieinanderliegende Rennen und einen Wochenvorschlag.
- Rennkarten, auswählbare Wettbewerbsdistanzen, Veranstalterlinks und Kalenderexport.
- Einstellungen für Wochenkilometer, zwei bis fünf Lauftage und das Trainingsziel; derzeit nur im Browser gespeichert.
- Einen einmaligen Laufdatenstand vom 18.10.2026 aus Traverse, ohne automatische Aktualisierung.

Traverse verwendet Express und Lit ohne Frontend-Build. `viewer/server.js` hält den geladenen Aktivitätsindex und registriert die bestehenden Funktionsmodule. `viewer/goals.js` liefert ein Vorbild für validierte JSON-Endpunkte und serialisierte atomare Schreibvorgänge. `calendar-page.js` zeigt bisher absolvierte Aktivitäten; `feed-page.js` enthält die Übersicht. Eine Rennverwaltung ist im geprüften Code noch nicht vorhanden.

## Geplante Bedienung

1. Navigationseintrag **Races** neben Calendar/Goals, passend zur englischen Traverse-Oberfläche.
2. Einstieg `/races?year=2027`: nächstes Rennen, aktuelle Laufstatistiken, Saisonzeitleiste und chronologische Rennkarten. Das Jahr lässt sich wechseln, auch ohne Aktivitäten in diesem Jahr.
3. **Add race** öffnet einen Dialog. Pflichtfelder: Name, Datum oder Terminfenster und gewählte Distanz. Optional: Ort, Veranstalterlink, Zielzeit, Notiz und Meldestatus.
4. Jedes Rennen lässt sich bearbeiten, archivieren und wiederherstellen. Archivieren blendet es aus der aktiven Planung aus; vergangene Rennen bleiben in der Saisonhistorie sichtbar.
5. **Set as training target** wählt genau ein aktives, zukünftiges Rennen aus. Nächstes Rennen und Trainingsziel sind getrennte Begriffe: ein näherer Nebenstart ersetzt das Trainingsziel nicht automatisch.
6. Rennkarten und Zeitleiste öffnen dieselbe Detailansicht. Dort erscheinen Ziel, Status, Vorbereitung und später die verknüpfte Aktivität.
7. Nach dem Rennen kann eine vorhandene Laufaktivität manuell verknüpft werden. Gemessene Distanz/Zeit stehen neben den geplanten Werten. Ein vergangener Termin allein bedeutet noch keine erfolgreiche Teilnahme.
8. Der bestehende Kalender erhält Rennmarker und **Add race** für einen gewählten Tag. Der Feed erhält eine kompakte Karte mit Countdown und Link zur Saison.

Desktop: gemeinsame Zeitachse mit einer Zeile pro Rennen. Mobil: lesbare Rennliste mit kompakten Phasen; die Zeitachse darf innerhalb ihres Bereichs horizontal scrollen. Alle Auswahlaktionen sind per Tastatur möglich und nicht allein durch Farbe erkennbar.

## Datenmodell und Speicherung

Neue Datei `DATA_DIR/races.json`, unabhängig von `goals.json`, Wellness-Dateien und generierten Aktivitätsdaten. Sie wird in die dokumentierten Backups aufgenommen. Eine fehlende Datei bedeutet einen leeren Rennkalender; eine beschädigte Datei führt zu einem sichtbaren Fehler und wird nicht überschrieben.

| Ebene | Vorgesehene Felder |
| --- | --- |
| Datei | `version: 1`, `races`, `settings` |
| Rennen | `id` (UUID), `name`, `startDate`, `endDate`, `dateConfirmed`, `distanceMeters`, `location`, `website`, `notes` |
| Eigene Planung | `registrationStatus` (`interested`, `registered`), `targetTimeSeconds` (optional), `outcome` (`planned`, `finished`, `dns`, `dnf`, `cancelled`), `archived` |
| Bezug und Historie | `activityId` (optional), `createdAt`, `updatedAt` |
| Einstellungen | `targetRaceId` (optional), `weeklyDistanceKm` (optional), `runDays` (2–5) |

Ein Eintrag beschreibt den persönlich gewählten Wettbewerb, nicht den kompletten Veranstaltungskatalog. Beim Hinzufügen kann zwischen Standarddistanzen und einer freien Distanz gewählt werden. Kilometer werden nur zur Anzeige verwendet; gespeichert wird in Metern, Zielzeiten in Sekunden.

Termine sind reine ISO-Kalendertage. Bei festem Datum gilt `startDate === endDate`. Solange nur ein Wochenende bekannt ist, bleiben beide Grenzen erhalten und `dateConfirmed` ist falsch. Countdown und Phasen zeigen dann ein Fenster, keinen erfundenen exakten Starttag. Bei Bestätigung wird das konkrete Datum gespeichert.

Das Trainingsziel ist eine einzelne Referenz in `settings`; dadurch können nicht versehentlich mehrere Rennen gleichzeitig als Hauptziel markiert werden. Archivieren/Absagen des Ziels entfernt diese Referenz in derselben Schreiboperation. Ein abgelaufenes Ziel bleibt historisch erhalten, wird aber nicht als laufende Vorbereitung angezeigt; die Seite fordert zur Auswahl eines neuen Ziels auf.

Schreibvorgänge übernehmen das serialisierte atomare Muster aus Goals. Die erste Version setzt wie das bestehende Projekt einen Serverprozess voraus. IDs und Zeitstempel werden serverseitig erzeugt; Referenzen werden vor dem Speichern validiert.

## Berechnungen

- Grundlage sind die aktuellen, bereits geladenen Traverse-Aktivitäten. Kein Abruf der gehosteten Referenz und keine Kopie des dortigen Snapshots zur Laufzeit.
- Nur Aktivitäten vom Typ `running` zählen; pro Aktivitäts-ID höchstens einmal. Distanz fehlt/ist ungültig: kein erfundener Kilometerwert. Keine Läufe bei vorhandenem Datenbestand: null Kilometer; fehlende Datenbasis: als fehlend kennzeichnen.
- Wochen beginnen montags in `Europe/Berlin`. „Letzte Woche“ ist die letzte abgeschlossene Montag–Sonntag-Woche; der Vier-Wochen-Schnitt verwendet vier abgeschlossene Wochen einschließlich Wochen ohne Läufe. Der Acht-Wochen-Verlauf folgt derselben Definition. Zeitraum und Datenstand werden angezeigt.
- Längster Lauf: maximale gültige Laufdistanz innerhalb derselben vier Wochen. Optionaler manueller Wochenumfang ist ein Planungswert und überschreibt niemals die gemessene Statistik.
- Nach einer Indexaktualisierung verwenden neue API-Abfragen die neuen Aktivitäten. Eine bereits offene Seite aktualisiert beim erneuten Fokussieren und über eine sichtbare Aktualisierungsaktion; dauerhaftes Streaming ist nicht erforderlich.
- Phasen werden aus Renndatum, Distanz und einem versionierten Phasenmodell abgeleitet. Die konkrete Formel der Referenz ist anhand der Oberfläche nicht vollständig geprüft und muss vor Übernahme im Quelltext untersucht werden. Keine pauschale Formel als identisch zur Referenz ausgeben.
- Nur das gewählte Trainingsziel steuert den Wochenvorschlag. Phasen anderer Rennen dienen der Einordnung; überlappende Umfänge werden nicht addiert. Enge Rennabstände werden als Planungskonflikt markiert. Schwellenwerte sind explizite Produktregeln und keine aus der Oberfläche abgeleiteten Fakten.
- Ein verknüpfter Lauf bleibt eine bestehende Aktivität. Rennen erzeugen keine FIT-Dateien und erhöhen weder Trainingskilometer noch Goal-Fortschritt. Fehlt die Aktivität nach einem Neuaufbau des Index, bleiben Rennplanung und Referenz erhalten und die Ansicht meldet die fehlende Verknüpfung.

## Technische Aufteilung

| Datei | Geplante Aufgabe |
| --- | --- |
| `viewer/races.js` | Store, Validierung, Renn-API und Registrierung über `registerRaces(app, { dataDir, getActivities })` |
| `viewer/race-planning.js` | Reine Funktionen für Laufstatistiken, Termine, Phasen und Kalenderexport |
| `viewer/server.js` | Modulregistrierung und HTML-Route `/races` |
| `viewer/public/races.html` | Seitengerüst nach Goals/Health-Vorbild |
| `viewer/public/races.css` | Rennkarten, Zeitleiste, Dialog und mobile Darstellung |
| `viewer/public/components/races-page.js` | Lit-Komponente und Interaktionen |
| `viewer/public/components/app-header.js` | Navigationseintrag |
| `viewer/public/components/calendar-page.js` | Rennmarker, Tagesdetails, Hinzufügen und Jahresauswahl |
| `viewer/public/components/feed-page.js` | Kompakte Rennübersicht im bestehenden Summary-Konzept |

Vorläufige Endpunkte:

| Methode und Pfad | Funktion |
| --- | --- |
| `GET /api/races?year=2027` | Rennliste mit berechneter Saisonansicht; Abfrage ohne Jahr liefert alle Rennen |
| `POST /api/races` | Rennen anlegen |
| `PUT /api/races/:id` | Rennen ändern, archivieren/wiederherstellen oder Aktivität verknüpfen |
| `PUT /api/races/settings` | Trainingsziel und Planungspräferenzen setzen |
| `GET /api/races/overview` | Jahresübergreifend nächstes Rennen, Trainingsziel und aktuelle Laufstatistiken |
| `GET /api/races/calendar.ics?year=2027` | Kalenderexport der aktiven Saisonrennen |

Feste Routen werden vor `/:id` registriert. Fehler verwenden verständliche 400/404/503-Antworten; Formulare behalten ihre Eingaben bei Speicherfehlern. Schreibend gelten wie bei Goals JSON-Limit, Origin-Prüfung und die vorhandene Tailnet-Zugriffsgrenze. Links erlauben nur HTTP(S), werden als Text sicher dargestellt und nicht serverseitig abgerufen.

ICS nutzt Ganztagstermine mit exklusivem Enddatum, stabile UIDs aus Renn-IDs und korrekt maskierte/faltbare Textfelder. Ein unbestätigtes Wochenende wird als vorläufiges mehrtägiges Fenster exportiert. Der Export ist ein Download; ein abonnierbarer Kalender und externe Synchronisierung sind spätere Erweiterungen.

## Umsetzung in drei Schritten

### 1. Nutzbare Rennverwaltung

Store/API, native Races-Seite, Jahrwahl, Hinzufügen/Bearbeiten, Archivierung, Trainingsziel, Countdown und manuelle Aktivitätsverknüpfung. Leerer Zustand mit **Add race**. Noch kein automatischer Trainingsplan.

Abnahme: Ein frei erstellter Halbmarathon erscheint nach Serverneustart unverändert. Ein Nebenrennen kann früher stattfinden, während der Halbmarathon Trainingsziel bleibt. Ergebnisse bleiben von Planzielen getrennt.

### 2. Integration in Traverse

Aktuelle Laufstatistiken, Kalender, Feed und ICS-Export. Kalenderjahre berücksichtigen auch zukünftige Rennen. Rennmarker bleiben von Aktivitäten optisch und rechnerisch getrennt. Für Rennmarker und Aktivitäten im Kalender gilt dieselbe Berlin-Tageszuordnung; die bisherige lokale Browser-Zeitzone muss dafür angepasst werden.

Abnahme: Ein Rennen 2027 lässt sich ohne Aktivität aus diesem Jahr im Kalender wählen. Der Feed findet das nächste Rennen auch über den Jahreswechsel. Eine importierte Aktivität aktualisiert die Statistiken nach dem nächsten Abruf, ohne Rennplanung zu verändern.

### 3. Saison- und Trainingsansicht der Referenz

Quelltext der Referenz gezielt prüfen, Phasenmodell festlegen und testen, Saisonzeitleiste übernehmen, Trainingsziel mit nahen Rennen einordnen und Wochenvorschläge ergänzen. Einstellungen serverseitig speichern. Wochenvorschläge als bearbeitbare Orientierung behandeln; keine ungeprüften Leistungsprognosen oder automatischen Umfangssteigerungen übernehmen.

Die sechs vorhandenen Berliner Termine werden als optionaler, einmaliger Startdatensatz angeboten. Sie werden nicht in jede Installation voreingetragen. Vor der Übernahme werden Termine und gewählte Wettbewerbe beim Veranstalter geprüft; insbesondere der Tierparklauf bleibt bis dahin ein Terminfenster. Bestehende Browsereinstellungen werden nicht stillschweigend als neue globale Vorgaben übernommen.

## Verifikation bei der Implementierung

- Berechnungen: Berlin-Tagesgrenzen, Sommerzeit, Jahreswechsel, leere Wochen, doppelte Aktivitäten, ungültige Distanzen, heute/vergangen/zukünftig, unsichere Terminfenster und überlappende Phasen.
- Store/API: Neustart, parallele Schreibvorgänge, beschädigte Datei, Eingabevalidierung, ungültiges Trainingsziel, Archivierung/Wiederherstellung und fehlende Aktivitätsreferenzen.
- Kalenderexport: stabile UID bei Änderungen, ein- und mehrtägige Termine, exklusives Enddatum sowie Sonderzeichen/Zeilenumbrüche.
- Browser: Hinzufügen → Bearbeiten → Zielwahl → Neustart → Wiederherstellen; Kalender/Feed/Detailansicht; mobile Darstellung, Tastatur und erhaltene Eingaben bei Fehlern.
- Bestehende Goals-, Health- und Feed-Prüfungen nach den betreffenden Integrationen ausführen. Planungsdaten dürfen niemals Aktivitätsstatistiken verändern.

## Bewusste Grenzen der ersten Version

Eigene Laufrennen, manuelle Terminpflege und die vorhandene Traverse-Datenbasis reichen für den ersten vollständigen Ablauf. Veranstaltersuche, GPX-Rennstrecken, Garmin-Rennimport, Meldungsautomatisierung, Geräteübertragung und ein allgemeiner Trainingsplan-Editor können später separat geplant werden. Goals bleibt für messbare Trainingsziele zuständig; ein Renntermin ist ein eigener Datensatz.
