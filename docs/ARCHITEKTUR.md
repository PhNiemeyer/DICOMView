# Architekturentscheidungen

## Bibliotheken (geprüft am 03.11.2026, jeweils aktuelle Version)

| Zweck | Bibliothek | Begründung |
|---|---|---|
| Darstellung, Fensterung, Stack-Viewports, MPR | **@cornerstonejs/core 5.15** | Referenzimplementierung für medizinische Webviewer (Basis von OHIF). Verarbeitet Rescale Slope/Intercept, VOI LUT, MONOCHROME1, Farbräume, Bildgeometrie (IPP/IOP/Pixel Spacing) und Volumen-Rekonstruktion mit vtk.js. |
| Messwerkzeuge, Fadenkreuze | **@cornerstonejs/tools 5.15** | Bietet LengthTool, AngleTool, CobbAngleTool (zwei frei gesetzte Linien), CircleROITool und CrosshairsTool. Interaktion (Auswählen, Ziehen, Bearbeiten, Löschen) und Bildkoordinaten-Verankerung sind enthalten. |
| DICOM-Dekodierung | **@cornerstonejs/dicom-image-loader 5.15** | Bringt WASM-Codecs mit (libjpeg-turbo, CharLS/JPEG-LS, OpenJPEG/JPEG 2000, OpenJPH/HTJ2K, JPEG-XL, JPEG Lossless, RLE) und dekodiert in Web Workern. Die Codecs werden mit der App gebündelt. |
| DICOM-Header beim Import | **dicom-parser** | Liest nur bis vor die Pixeldaten (`untilTag`), deshalb kein vollständiges Laden großer Dateien. |
| ZIP | **@zip.js/zip.js** | Liest das zentrale Verzeichnis direkt aus dem Blob (wahlfreier Zugriff) und hält das Archiv nicht komplett im Speicher. Entpackt Eintrag für Eintrag per `DecompressionStream`. |
| Deflate-DICOM | **fflate** | `DecompressionStream` lehnt das bei manchen Schreibern übliche Füllbyte am Ende ab; fflate toleriert es. |
| Lokaler Arbeitsbestand | **IndexedDB** (über `idb`) | Blobs werden auf der Festplatte des Browsers gehalten, nicht im RAM. |
| UI | React 19, zustand, lucide-react (Linienicons mit 1,5 px Strichstärke) | – |
| Schrift | Geist Variable (`@fontsource-variable/geist`), DM Sans als Ersatz | Wird lokal gebündelt, kein Google-Fonts-Abruf. |

**Bewusst nicht selbst implementiert:** DICOM-Dekodierung, Fensterung/LUTs, Rendering, Messwerkzeug-Interaktion, MPR-Rekonstruktion und Fadenkreuze.

**Selbst implementiert, weil fachlich spezifisch:**

- **Messwert-Texte und Kalibrierungslogik** (`src/cs/measure.ts`, `calibration.ts`, `geometry.ts`, getestet). Cornerstone zeigt Werte im DICOM-Maßstab an. Gefordert sind aber Herkunftsangabe, Referenzkugel, bekannte Strecke, die 1,1-Konvention ohne Doppelanwendung und reine Pixelwerte ohne Basis. Deshalb setzen die Werkzeuge eigene `getTextLines`-Funktionen ein. Diese rechnen die Handles in Bildpixel um (`worldToImageCoords`) und wenden die *effektive* Kalibrierung an. Winkel werden im physikalischen Seitenverhältnis berechnet.
- **Masken** (`src/cs/masks.ts`): Rechtecke in Bildpixel-Koordinaten. Sie werden über `imageToWorldCoords` und `worldToCanvas` in die Ansicht projiziert und machen deshalb Zoom, Verschieben, Drehen und Spiegeln mit. Gezeichnet wird auf einer deckenden Ebene **oberhalb** des gerenderten Bildes; Helligkeitsänderungen am Bild wirken dort nicht. Beim Export werden sie in das Ausgabe-Raster **gemalt**, die Pixel also tatsächlich ersetzt.
- **Import-Pipeline, Speicherlimit und Löschung.**

## Datenfluss

```
Dateien/Ordner/ZIP ──► Import-Worker (Typ am Inhalt, ZIP-Grenzen, Header-Parsing)
                          │  postMessage(Blob + Metadaten), wartet auf Bestätigung (Gegendruck)
                          ▼
                 Hauptthread: Duplikatprüfung, Speicherlimit/LRU, Schreiben in IndexedDB
                          ▼
   Anzeige: Blob ──► wadouri.fileManager ──► Cornerstone (Dekodierung in Workern, begrenzter Cache)
```

- **Dateitypen** werden ausschließlich am Inhalt erkannt (Magic Bytes, DICM-Präfix, Heuristik für präambellose Datensätze). Dateiendungen werden ignoriert.
- **ZIP-Schutz:**
  - Entscheidend ist die *deklarierte entpackte* Gesamtgröße aus dem zentralen Verzeichnis, nicht die Archivgröße. Liegt sie über dem Arbeitslimit, wird nicht entpackt.
  - Je Eintrag gilt ein Kompressionsverhältnis von max. 250:1 (ab 32 MB).
  - Höchstens 50 000 Einträge, Verschachtelungstiefe 2.
  - Beim Entpacken werden die tatsächlich erzeugten Bytes gezählt. Überschreiten sie die deklarierte Größe, wird abgebrochen (Schutz gegen manipulierte Größenangaben).
- **Gegendruck:** Der Worker verarbeitet die nächste Datei erst, wenn der Hauptthread die vorige gespeichert hat. Der Speicherbedarf bleibt so auf eine Datei begrenzt (max. 600 MB je Datei).
- **Speicherlimit:**
  - Vor jedem Speichern prüft der Importer, ob das Limit eingehalten wird.
  - Wenn nicht, entfernt er die am längsten nicht verwendeten Untersuchungen (`lastAccessed`). Ausgenommen sind die gerade angezeigten, die in laufenden Exporten und die im selben Import.
  - Das geschieht nur, wenn dadurch wirklich genug Platz frei wird. Sonst stoppt der Import mit Erklärung.
- **Arbeitsspeicher:**
  - Dekodiert wird erst bei Bedarf.
  - Cornerstone-Bildcache maximal 768 MB.
  - Vorschauen werden einmalig mit 160 px erzeugt.
  - Serien, die nicht mehr angezeigt werden, geben Dataset und dekodierte Bilder frei.
  - Das MPR-Volumen wird beim Verlassen entfernt.
  - Exporte nutzen eine temporäre, danach zerstörte Rendering-Engine.

## Stabile Identität

Cornerstone-imageIds (`dicomfile:N`) gelten nur für eine Sitzung. Deshalb sind Messungen, Kalibrierungen und Masken über einen stabilen **Instanzschlüssel** (`SOPInstanceUID#Frame`) gespeichert. `src/cs/registry.ts` ordnet beide Seiten einander zu. Messungen werden beim Öffnen einer Serie wiederhergestellt.

## Export in Originalauflösung

Für einen Screenshot wird das Bildfeld in einer **separaten, unsichtbaren Rendering-Engine** neu gerendert:

- Dabei gilt ein temporärer Skalierungsfaktor (`devicePixelRatio`-Override nur während des Exports).
- „Originalauflösung“ bedeutet: 1 Bildpixel ≈ 1 Exportpixel bei der aktuellen Ansicht. Begrenzt auf 8192 px Kantenlänge bzw. 40 MP.
- Fensterung, Invertierung, Drehung, Spiegelung, Zoom und Verschiebung werden übernommen.
- Messungen werden als Vektorgrafik (SVG) skaliert darübergelegt; Masken ersetzen danach die Pixel.
- Patienten-Overlays, Listen und Werkzeugleisten sind nicht Teil dieser Engine und können deshalb nicht im Export landen.
- PNG und JPEG über `canvas.toBlob` enthalten keine Metadaten.

## Datenschutz-Maßnahmen

- Content-Security-Policy (`connect-src 'self'`) blockiert Verbindungen zu Fremd-Hosts, auch versehentliche.
- Keine Patientendaten in URLs (keine Routen mit IDs), Dateinamen (neutral, `dicomview_JJJJMMTT-hhmmss`) oder Konsolenausgaben der App.
- Fehlermeldungen beim Import nennen nur den Dateipfad innerhalb der Auswahl des Nutzers.
- Einstellungen in `localStorage` enthalten nur Sprache, Limit, Löschzeit, Stil und Overlay-Schalter. Der einzige weitere Wert ist der Zeitstempel des ersten Speicherns, den die Löschlogik braucht.

## Erweiterbarkeit für Version 2

- **Eingabe:** Pointer Events und Cornerstone-Bindings funktionieren auch mit Touch; das Werkzeug-Mapping steckt zentral in `setPrimaryTool`.
- **Windows:** Keine macOS-spezifischen APIs; die Tastenkürzel sind plattformneutral.
- **iPad:** Das Layout hat einklappbare Nebenbereiche und einen Breakpoint bei 1200 px. Für Touch fehlen noch größere Trefferflächen und Gesten für Fensterung.
