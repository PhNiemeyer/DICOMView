# DICOMView

DICOMView ist ein webbasierter DICOM- und Bildviewer, mit dem sich Vorträge und Publikationen vorbereiten lassen. **Sie ist nicht für die diagnostische Befundung gedacht.**

Alle Bilder, Metadaten, Messungen und Exporte werden ausschließlich lokal im Browser verarbeitet. Es gibt keinen Server für Patientendaten, keine Analyse-, KI- oder OCR-Dienste und keine CDN-Abhängigkeiten. Die Content-Security-Policy in `index.html` lässt nur Verbindungen zur eigenen Herkunft zu.

## Start

Voraussetzung ist Node.js 20 oder neuer.

```bash
npm install
```

```bash
npm run build
```

```bash
npm run preview
```

Danach `http://localhost:4173` in Chrome (primär) oder Safari öffnen. Für die Entwicklung gibt es `npm run dev` (Port 5173).

Der Ordner `dist/` ist eine rein statische Website. Er lässt sich von jedem beliebigen Webserver ausliefern; Patientendaten erreichen diesen Server dabei nie. Wichtig: Der Zugriff muss über `http://localhost` oder HTTPS erfolgen. IndexedDB, Web Workers und WASM setzen einen sicheren Kontext voraus, `file://` funktioniert nicht.

### Veröffentlichung (GitHub Pages)

Bei jedem Push auf `main` baut `.github/workflows/pages.yml` die App und veröffentlicht `dist/` auf GitHub Pages (`https://phniemeyer.github.io/dicomview/`). Einmalig nötig: *Settings → Pages → Build and deployment → Source: GitHub Actions*. Die Seite enthält nur den Programmcode – Bilder und Patientendaten verlassen auch dort nie das Gerät.

### Eigener Server (Docker, z. B. Hostinger VPS)

`deploy/docker-compose.yml` lädt das fertig gebaute Paket aus dem GitHub-Release `site-latest` (wird bei jedem Push auf `main` neu erzeugt) und liefert es mit Caddy aus – inklusive automatischem HTTPS-Zertifikat (Let's Encrypt). Ohne eigene Domain eignet sich die kostenlose Adresse `<IP mit Bindestrichen>.sslip.io` (z. B. `203-0-113-10.sslip.io`):

```bash
SITE_ADDRESS=203-0-113-10.sslip.io docker compose -f deploy/docker-compose.yml up -d
```

Ports 80 und 443 müssen frei und in der Firewall offen sein. HTTPS ist Pflicht (IndexedDB-/Krypto-/Tab-Funktionen brauchen einen sicheren Kontext).

### Tests

```bash
npm test
```

Startet die Unit-Tests (Geometrie, Kalibrierung, Typerkennung, Sortierung, MPR-Eignung, Löschzeitpunkt, Deflate).

```bash
python3 -I tools/make_testdata.py testdata
```

Erzeugt synthetische Testdaten. Benötigt `pip install pydicom numpy pillow`.

```bash
node tools/e2e-acceptance.mjs test-results
```

Führt den Browser-Abnahmetest aus (Playwright/Chromium). Vorher muss `npm run preview` laufen.

## Bedienung (Kurzfassung)

| Aktion | Maus / Trackpad | Tastatur |
|---|---|---|
| Durch eine Serie blättern | Mausrad / Zwei-Finger-Scrollen, Schieberegler unten im Bildfeld | ↑ ↓ ← →, Bild↑/Bild↓ (±10), Pos1/Ende |
| Zoom | Strg + Scrollen, Trackpad-Pinch, rechte Maustaste ziehen, Werkzeug „Zoom“ | Z |
| Verschieben | mittlere Maustaste, Werkzeug „Verschieben“ | P |
| Fensterung / Helligkeit + Kontrast | Werkzeug „Fensterung“ oder Shift + Ziehen | W |
| Länge, Winkel, 2-Linien-Winkel, Kreis | Werkzeug wählen, im Bild ziehen bzw. klicken | L, A, C, O |
| Maske | Rechteck ziehen; anklicken zum Verschieben, Ecken zum Skalieren | M, Entf |
| Invertieren, Drehen, Spiegeln, Anpassen, Zurücksetzen | Werkzeugleiste | I, R (⇧R links), H, V, F, 0 |
| Layout 1 / 2 / 4 Bildfelder | Kopfleiste | 1, 2, 4 |
| Aktives Bildfeld | in das Bildfeld klicken (Teal-Rahmen) | – |
| Serie in ein Bildfeld laden | Vorschau anklicken (aktives Feld) oder in ein Feld ziehen | – |

## Unterstützte Formate

- **DICOM Part 10** (mit oder ohne Dateiendung) und **DICOM-Datensätze ohne Präambel/Meta-Header** (implicit und explicit VR). Sie werden lokal um einen gültigen Header ergänzt.
- **Transfersyntaxen**, geprüft mit öffentlichen anonymisierten pydicom-Beispielen:
  - Implicit/Explicit VR Little Endian, Explicit VR Big Endian
  - Deflated (wird lokal entpackt)
  - RLE
  - JPEG Baseline, JPEG Extended, JPEG Lossless
  - JPEG-LS
  - JPEG 2000 (lossless und lossy)

  HTJ2K und JPEG-XL-Decoder werden mitgeliefert, sind aber mangels Testdaten ungeprüft.
- **Photometric Interpretation:** MONOCHROME1/2, RGB, PALETTE COLOR, YBR (komprimiert). Rescale Slope/Intercept und VOI LUT werden über Cornerstone angewendet.
- **Multiframe-DICOM** (jedes Frame ist ein eigenes Bild in der Serie)
- **JPEG, PNG, BMP.** Graustufenbilder werden als echte Graustufen geladen, damit Fensterung und Invertierung korrekt funktionieren.
- **Ordner mit Unterordnern** (Drag & Drop oder „Ordner…“)
- **ZIP-Archive.** Sie werden lokal entpackt, verschachtelte ZIPs bis Tiefe 2.
- **DICOMDIR** wird erkannt und übersprungen. Die Zuordnung zu Patient, Untersuchung und Serie erfolgt über die Metadaten jeder einzelnen Datei; das ist robuster als das Verzeichnis selbst.

Nicht unterstützt sind DICOM ohne Bilddaten (SR, RT-Pläne, Präsentationszustände usw.). Sie werden mit Hinweis übersprungen.

## Was in Version 1 enthalten ist (nach Phasen)

1. **Grundlage, Gestaltung, Import:** Oberfläche im Brand Design (Navy, Petrol, Turquoise, Teal, Mist, Line; Geist/DM Sans lokal gebündelt; dünne Linienicons; aktive Zustände in Teal; neutraler schwarzer Bildbereich). Der Import erkennt Dateitypen am Inhalt, zeigt Fortschritt und lässt sich abbrechen. Probleme werden pro Datei gemeldet, Duplikate über die SOP Instance UID erkannt (bei Bildern über SHA-256).
2. **Patientenstruktur und Bildwerkzeuge:** Hierarchie Patient → Untersuchung → Serie → Bild.
   - Patienten werden über Patienten-ID + Issuer + Geburtsdatum zugeordnet. Gleiche Namen führen nie zu einer Zusammenführung.
   - Untersuchungen sind absteigend nach Datum sortiert. Das Datum steht an erster Stelle, danach Körperregion/Modalität und Beschreibung.
   - Serien erscheinen mit echten Vorschaubildern, Bezeichnung, Bildanzahl, Modalität und Orientierung (AX/COR/SAG/OBL).
   - Sortierung über ImagePositionPatient entlang der Schichtnormalen.
   - Layout mit 1, 2 oder 4 Bildfeldern.
   - Zoom, Verschieben, WW/WL (auch numerisch) und CT-Presets.
   - Invertieren, Drehen, Spiegeln, Anpassen und Zurücksetzen arbeiten nicht destruktiv.
   - Patienten und Untersuchungen lassen sich einzeln entfernen.
   - JPEG/PNG/BMP werden über einen Dialog einem bestehenden oder neuen Patienten bzw. einer Untersuchung zugeordnet.
3. **Messungen und Kalibrierung:**
   - Werkzeuge: Länge, Dreipunktwinkel, 2-Linien-Winkel (Innenwinkel ≤ 90°, Ergänzungswinkel oder beide, eindeutig beschriftet), Kreis (Ø).
   - Jede Messung ist auswählbar, verschiebbar, nachträglich bearbeitbar und löschbar. Es gibt 4 Linienstärken und 7 Farben; die Einstellungen gelten für neue Messungen. Die Sichtbarkeit lässt sich umschalten.
   - Kalibrierung: DICOM-Maßstab mit Herkunftsangabe, Referenzkugel (mit Zusammenfassung vor der Übernahme), bekannte Strecke und „Vergrößerungsfaktor 1,1“ (nur mit physikalischer Basis). Eine Übertragung auf die ganze Serie gibt es nur ausdrücklich und nur bei identischer Geometrie.
4. **Maskierung und Export:**
   - Maskenrechtecke werden in Bildkoordinaten verankert, lassen sich verschieben, skalieren und löschen.
   - Füllfarbe: Pipette, Schwarz oder freie Farbe.
   - Masken gelten für ein Bild oder ausdrücklich für die ganze Serie (beim Blättern sichtbar).
   - Screenshot als PNG/JPEG, mit Vorschau. Bereich: aktives Bildfeld, gesamte Vergleichsansicht oder ein frei gewählter Ausschnitt; jeweils mit oder ohne Messungen.
   - Auflösung: Originalauflösung oder 1–4×.
   - Neutraler Dateiname. Masken ersetzen die Pixel immer.
   - Videoexport (siehe unten).
5. **MPR:** separate Ansicht mit axialer, koronarer und sagittaler Rekonstruktion. Die Fadenkreuze sind gekoppelt; Scrollen, Fensterung, Zoom und Presets sind verfügbar. Voxelabstände und Orientierung werden berücksichtigt. Ungeeignete Serien werden mit Begründung abgelehnt.
6. **Speicherverwaltung und Löschung:**
   - Konfigurierbares Arbeitslimit (Standard 1 GB, inklusive entpackter Inhalte).
   - Automatisches Entfernen der am längsten nicht verwendeten Untersuchungen mit Hinweis. Angezeigte Untersuchungen und laufende Videoaufnahmen sind geschützt. Leere Patienteneinträge werden entfernt.
   - Kontrollierter Stopp mit Erklärung, wenn kein Platz frei wird.
   - Tägliche Löschung um 23:59 (abschaltbar) und „Alle lokalen Daten jetzt löschen“.

## Videoexport: Codecs und Browser

Die Aufnahme kommt direkt aus den gerenderten Bildfeldern (Canvas → `MediaRecorder`), nicht aus einer Bildschirmaufnahme. Mauszeiger, Werkzeugleisten und Listen sind deshalb nie im Video. Ein Frame entsteht nur, wenn ein Bild vollständig gerendert ist. Vor dem Start wird die ganze Serie vorgeladen. So können beim schnellen Scrollen keine ungeladenen Schichten ins Video gelangen.

- **Chrome (aktuell):** `video/mp4; codecs=avc1` (H.264) wird nativ unterstützt. Im Test entstand eine echte MP4-Datei (`ftyp`-Box geprüft).
- **Safari (ab 14.1):** MediaRecorder schreibt nativ MP4/H.264.
- **Ältere Browser ohne MP4-Encoder:** Die App weicht auf WebM aus, kennzeichnet das sichtbar und speichert mit der Endung `.webm`. Ein MP4-Export wird also nie vorgetäuscht. Eine lokale Konvertierung (z. B. ffmpeg.wasm, ca. 30 MB, langsam und speicherintensiv) wurde bewertet und bewusst **nicht** eingebaut, weil beide Zielbrowser MP4 nativ erzeugen.
- **Grenzen:** wählbare Höchstdauer (30 s bis 10 min) und 500 MB Dateigröße; danach wird automatisch gestoppt und gespeichert. 30 fps; die Auflösung entspricht der Bildschirmauflösung des Bereichs (Anzeige vor dem Start).

## Automatische tägliche Löschung

- Der Fälligkeitszeitpunkt ist das erste 23:59 (lokale Gerätezeit) nach dem ersten Speichern von Daten.
- Geprüft wird **vor jeder Bildanzeige beim Start**, beim Aktivieren oder Fokussieren eines Tabs, bei `pageshow` (Rückkehr aus dem Ruhezustand bzw. bfcache), bei Interaktion und alle 10 Sekunden. Die App verlässt sich also nicht allein auf einen Timer.
- Mehrere Tabs koordinieren sich über Web Locks, BroadcastChannel und einen Epoch-Zähler. Andere Tabs laden sofort neu und zeigen nichts mehr an. Schreibvorgänge eines veralteten Tabs werden verworfen.
- Gelöscht werden die komplette IndexedDB (Bilder, Metadaten, Listen, Vorschauen, Messungen, Kalibrierungen, Masken), Cache Storage und sessionStorage. Erhalten bleiben nur Einstellungen ohne Patientenbezug (Sprache, Limit, Löschzeit, Stil).
- Die Funktion entfernt den von der Anwendung verwalteten lokalen Arbeitsbestand vollständig. Sie überschreibt **nicht** forensisch sicher die SSD, Betriebssystem-Backups oder interne Browserdateien. Originaldateien und heruntergeladene Exporte bleiben unberührt.

## Browsergrenzen

- **Chrome ≥ 120 (macOS)** wird primär unterstützt und ist automatisiert getestet (Chromium 14x headless, siehe Prüfbericht).
- **Safari ≥ 16.4 (macOS)** ist das zweite Ziel. Grund für die Mindestversion: OffscreenCanvas, `webkitdirectory`, BroadcastChannel, Web Locks, MediaRecorder-MP4 und `CompressionStream` für ZIP. **Safari konnte in dieser Umgebung nicht automatisiert getestet werden** (kein WebKit verfügbar), siehe Einschränkungen.
- **Speicher:** Das Browser-Kontingent für IndexedDB hängt vom freien Speicherplatz ab (bei Safari kann eine Rückfrage erscheinen). Im privaten Modus ist es stark begrenzt.
- **Arbeitsspeicher:** Das 1-GB-Limit gilt für gespeicherte Nutzdaten. Hinzu kommen der dekodierte Bild-Cache (begrenzt auf 768 MB), WebGL-Texturen und für MPR das Volumen (z. B. 512×512×600 Int16 ≈ 300 MB).

## Nicht implementiert / bewusst ausgeschlossen (Version 1)

- PACS-Anbindung, DICOM-Export, Druck, Cloud-Ablage, Benutzerkonten, Offline-Modus (PWA)
- Flächenmessung (bewusst nicht enthalten)
- 3D-Volumenrendering
- Automatische Erkennung oder OCR eingebrannter Schrift, automatische Rekonstruktion verdeckter Bildbereiche
- Darstellung von DICOM-Overlays (60xx). Sie werden **nicht angezeigt und nie exportiert** und gelten damit als „ausgeblendet“.
- Messungen in der MPR-Ansicht, Export aus der MPR-Ansicht
- Windows und iPad/Touch (Version 2). Pointer Events, Werkzeug-Bindings und Layout sind darauf vorbereitet.

## Bekannte Einschränkungen

Siehe [docs/PRUEFBERICHT.md](docs/PRUEFBERICHT.md#verbleibende-einschränkungen).
