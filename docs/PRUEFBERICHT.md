# Prüfbericht (Version 0.1, 03.11.2026)

## Testumgebung

- Linux-Container, Chromium (Playwright-Build 1243, headless, WebGL über SwiftShader), Node 22
- Produktions-Build (`npm run build` + `vite preview`)
- Testdaten: **synthetisch**, erzeugt mit `tools/make_testdata.py`, plus öffentliche anonymisierte Beispieldateien aus dem pydicom-Paket. Es wurden keine realen Patientendaten verwendet.
  - CT-Phantom: 40 Schichten, 128², 0,5 mm Pixel, 1 mm Schichtabstand. Dateinamen gemischt, ohne Endung, in Unterordnern; die InstanceNumber ist absichtlich umgekehrt. Enthält eine Kugel mit r = 10 mm und einen eingebrannten „Schrift“-Block.
  - DX-Aufnahme MONOCHROME1 mit Imager Pixel Spacing 0,1 mm: eine Linie von 500 px, ein Kreis mit 200 px Durchmesser. Dieselbe Aufnahme gibt es zusätzlich mit ERMF 1,1.
  - Zweite Patientin mit gleichem Namen, aber anderer Patienten-ID.
  - JPEG/PNG/BMP mit einer Linie von 100 px und einem Kreis von 200 px.
  - Defekte DICOM-Datei, leere Datei, Textdatei, ZIP-Archiv des gesamten Ordners, ZIP-Bombe (300 MB Nullen → 300 KB).
  - 17 pydicom-Beispiele: RLE, JPEG Baseline, Extended und Lossy, JPEG-LS, JPEG 2000, Deflate, Big Endian, Palette, YBR, Overlay, SR, präambellos.

## Automatische Prüfungen

- **Unit-Tests** (`npm test`): 14/14 bestanden. Abgedeckt sind Länge bei anisotropem Pixelabstand, Dreipunktwinkel, 2-Linien-Winkel (Innen- und Ergänzungswinkel, unabhängig von der Zeichenrichtung), Winkel bei nicht quadratischen Pixeln, Kreisdurchmesser, Kalibrierungsherkunft (CT, DX, ERMF, JPEG), die 1,1-Regel, manuelle Kalibrierung mit Seitenverhältnis, Typerkennung am Inhalt, geometrische Sortierung, MPR-Eignung (Lücke, Orientierung, Anzahl), Löschzeitpunkt 23:59 und Deflate-Umkodierung.
- **Browser-Abnahmetest** (`tools/e2e-acceptance.mjs`): **48/48 bestanden**. Vollständige Ausgabe:

| Prüfung | Ergebnis |
|---|---|
| Import gemischter Ordner (40 CT, 1 SC, 3 DX, 3 Bilder) | ✅ 47 importiert, 3 Hinweise |
| Fehlerhafte Dateien verständlich gemeldet, Import läuft weiter | ✅ |
| Gleicher Name, andere Patienten-ID → getrennte Patienten | ✅ |
| Untersuchungen absteigend nach Datum | ✅ |
| Bilddateien einem neuen Patienten zugeordnet | ✅ |
| DICOM- und Bild-Duplikate erkannt (Re-Import) | ✅ 47 Duplikate |
| Serie nach ImagePositionPatient sortiert (nicht nach Name/InstanceNumber) | ✅ |
| Schichtnavigation per Tastatur | ✅ |
| CT-Preset Knochen 2000/400 | ✅ |
| Länge DX: 500 px × 0,1 mm = 50,0 mm | ✅ |
| Vergrößerungsfaktor 1,1: 50,0 → 45,5 mm, gekennzeichnet „(÷1,1)“ und im Bildfeld | ✅ |
| Messung bleibt bei Drehen, Spiegeln, Zoom 1,7×, Verschieben am Bildpunkt (Abweichung 0,00 px) und behält ihren Wert | ✅ |
| ERMF berücksichtigt → 45,5 mm; Faktor 1,1 dort gesperrt (keine Doppelanwendung) | ✅ |
| Referenzkugel: Zusammenfassung (200 px ≙ 25 mm → 0,125 mm/px) und Übernahme → Ø 25,0 mm | ✅ |
| JPEG ohne Basis: nur „px“; Faktor 1,1 abgelehnt | ✅ |
| Bekannte Strecke: 100 px ≙ 10 mm → 10,0 mm; Kreis 200 px → Ø 20,0 mm | ✅ |
| Dreipunktwinkel 90,0°; 2-Linien-Winkel ohne Berührung 30,0° (innen) / 150,0° (Ergänzung) | ✅ |
| Farbe einer Messung nachträglich geändert | ✅ |
| Serienmaske beim Scrollen auf allen Schichten | ✅ |
| Export ohne Messungen: maskierte Pixel = 0, nach Aufhellen (×8 + 50) Standardabweichung 0 | ✅ |
| Export in Originalauflösung (128 Bildpixel → 128 Exportpixel), neutraler Dateiname | ✅ |
| Video: Datei `.mp4` mit echter `ftyp`-Box (H.264) | ✅ |
| MPR axial/koronar/sagittal; DX-Einzelbild verständlich abgelehnt | ✅ |
| 4 Bildfelder; englische Oberfläche | ✅ |
| Fällige Löschung beim Aktivieren des Tabs; zweiter Tab zeigt nichts mehr | ✅ |
| Neustart nach fälliger Löschung: keine alten Daten sichtbar | ✅ |
| „Alle lokalen Daten jetzt löschen“; nächste Löschung angezeigt | ✅ |
| ZIP mit Unterordnern; ZIP-Bombe nicht entpackt | ✅ |
| Dekodierung von 23 Serien in 9 Transfersyntaxen | ✅ (siehe Einschränkung YBR_FULL_422) |
| LRU-Entfernung mit Hinweis, leerer Patient entfernt; angezeigte Untersuchung geschützt → kontrollierter Stopp | ✅ |
| Keine Netzwerkanfragen an externe Hosts während des gesamten Tests | ✅ 0 Anfragen |
| Keine unbehandelten Laufzeitfehler | ✅ |

Zusätzlich wurde jedes Beispiel einzeln gerendert: 14 von 15 Bildserien werden korrekt dargestellt. Unkomprimiertes **YBR_FULL_422** scheitert im Cornerstone-Renderer. Das Bildfeld zeigt dafür eine Fehlermeldung, die übrige Anwendung läuft weiter.

## Nicht automatisiert geprüft (manuelle Prüfung erforderlich)

| Bereich | Grund | Empfohlene Prüfung |
|---|---|---|
| **Safari (macOS)** | Kein WebKit in der Testumgebung | Abnahmetest manuell durchgehen: Import per Drag & Drop und Ordnerdialog, MP4-Aufnahme, tägliche Löschung mit zwei Tabs |
| Chrome auf echter macOS-Hardware (GPU statt SwiftShader), Trackpad-Gesten (Pinch = Zoom, Zwei-Finger = Blättern) | Headless-Linux | Kurztest auf dem Zielgerät |
| Dateien um 500 MB, Untersuchungen nahe 1 GB | Testdaten bewusst klein | Mit großem anonymisiertem Datensatz Import und Speicher beobachten |
| Ruhezustand des Geräts | Nicht simulierbar; die zugrunde liegende Logik (`pageshow`/`focus`/`visibilitychange` + Fälligkeit nach Zeitstempel) ist getestet | Gerät nach 23:59 aufwecken |
| Visuelle Qualität echter Röntgen-, CT- und MR-Daten | Nur synthetische bzw. kleine Beispieldaten | Mit repräsentativen anonymisierten Fällen prüfen |

## Verbleibende Einschränkungen

1. **Safari ist ungetestet.** Die verwendeten APIs werden laut Hersteller ab Safari 16.4 unterstützt. Abweichungen bei WebGL-Leistung, IndexedDB-Kontingent und MediaRecorder sind trotzdem möglich.
2. **Unkomprimiertes YBR_FULL_422** wird nicht dargestellt (Cornerstone-Einschränkung). Es erscheint eine Fehlermeldung.
3. **DICOM-Overlays (60xx)** werden weder angezeigt noch exportiert. Wer sie für eine Präsentation braucht, sieht sie in Version 1 nicht.
4. **Kalibrierungsheuristik bei Projektionsaufnahmen:** Bei CR/DX/MG/XA/RF mit *nur* Pixel Spacing und ohne Pixel Spacing Calibration Type wird der Maßstab als Detektorebene angenommen. Herkunft und Annahme stehen im Panel. Bei abweichenden Herstellerkonventionen kann das nicht stimmen; dann bitte Referenzkugel oder bekannte Strecke verwenden.
5. **Manuelle Kalibrierung** behält das native Pixel-Seitenverhältnis bei (bei JPEG quadratisch). Eine getrennte Kalibrierung beider Achsen ist nicht vorgesehen.
6. **Masken** sind einfarbige Rechtecke. Bei ungleichmäßigem Hintergrund bleibt die Fläche sichtbar. Es gibt keine automatische Erkennung eingebrannter Schrift und **keine Garantie vollständiger Anonymisierung**.
7. **Exportauflösung:** „Originalauflösung“ bezieht sich auf das aktive Bildfeld bei aktueller Ansicht und ist auf 8192 px bzw. 40 MP begrenzt. Bei der Vergleichsansicht mit unterschiedlich großen Bildern gilt der Faktor des aktiven Feldes.
8. **Video** wird in Bildschirmauflösung mit 30 fps aufgenommen (keine höhere Exportauflösung). Messungstexte werden pro Frame als SVG gerastert; bei sehr vielen Annotationen kann die Bildrate sinken.
9. **Speicherbedarf:** Das Arbeitslimit gilt für gespeicherte Daten. Dekodierte Bilder (Cache max. 768 MB) und MPR-Volumen brauchen zusätzlich Arbeitsspeicher. Große MPR-Volumen können auf Geräten mit wenig RAM scheitern.
10. **MPR** nur für Einzelbild-Serien mit gleichmäßigem Schichtabstand (Toleranz 10 %). Enhanced-Multiframe-CT/MR und Serien mit Gantry-Neigung werden abgelehnt.
11. **Import abgebrochen oder Limit erreicht:** Bereits gespeicherte Dateien bleiben im Arbeitsbestand; eine Serie kann dann unvollständig sein (wird so gemeldet).
12. **Löschung:** Sie entfernt den App-Arbeitsbestand vollständig, überschreibt aber nicht forensisch sicher. Bleibt der Browser über 23:59 hinaus ohne Fokus offen, löscht der 10-Sekunden-Timer; drosselt der Browser Hintergrund-Tabs, spätestens beim nächsten Aktivieren und immer vor der nächsten Bildanzeige.
13. **Bundlegröße** ca. 4 MB JS (gzip 1,1 MB) plus WASM-Codecs. Der erste Start dauert entsprechend.
14. **Testhaken:** Mit `?e2e` in der URL stellt die App interne Funktionen für automatisierte Tests bereit (enthält keine Daten). In einem späteren Release-Build kann das entfernt werden.
