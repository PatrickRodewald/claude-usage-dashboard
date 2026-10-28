# Pixel-Büro · Stufe 2 · A + B1 + C + B2 + D

Kumulatives Grafikpaket mit **223 Sprites und 29 Animationen**.
Paket D ergänzt 17 Oberflächensprites: drei Teppiche, einen Steinboden,
neun Läuferteile und vier Wandarten. Alle vorherigen Pakete bleiben enthalten.

## Neue Grafik und Atlas

`public/assets/office/tiles/surfaces.png` ist ein gepacktes Blatt mit
**64 × 96 nativen Pixeln**. Die einzelnen Atlas-Ausschnitte verwenden;
unbenutzte Bereiche bleiben transparent.

| Sprites | Native Größe | Platzierung | Bewegung |
| --- | --- | --- | --- |
| `carpet-blue`, `carpet-green`, `carpet-wine` | je 16 × 16 | Boden | begehbar |
| `tile-lobby` | 16 × 16 | Boden | begehbar |
| `runner-top-left`, `runner-top`, `runner-top-right` | je 16 × 16 | Boden | begehbar |
| `runner-left`, `runner-center`, `runner-right` | je 16 × 16 | Boden | begehbar |
| `runner-bottom-left`, `runner-bottom`, `runner-bottom-right` | je 16 × 16 | Boden | begehbar |
| `wall-brick`, `wall-glass`, `wall-wood`, `wall-green` | je 16 × 32 | Wand | blockiert |

Alle neuen Sprites haben `frames: 1` und `anchor: [0, height]`.
Bodenbeläge sind vollständig deckend und haben `placement: "floor"`,
`footprintTiles: [1,1]`, `blocksMovement: false`, `againstWall: false`.
Wände haben `placement: "wall"`, `wallY: 0` und, wie die vorhandene
strukturelle Wand, `blocksMovement: true`. Es kommen keine Animationen hinzu.

Der Atlas bleibt bei `meta.schemaVersion: 2`. Ein Bild, 17 Sprites und
`nineSlice.runner` ergänzen den Bestand. Alle **206 bisherigen Spriteeinträge**,
alle 29 Animationen und die übrigen bisherigen Metadaten bleiben unverändert.
Alle **25 vorherigen PNG-Dateien sind bytegleich** erhalten.

## Bodenmuster und Wände

Die Teppiche verwenden dasselbe feine Punktmuster, eingefärbt in Blau,
Grün und Weinrot. Das Muster wiederholt alle acht nativen Pixel; jede
16-Pixel-Kachel enthält denselben vollständigen Rapport zweimal pro Achse.
Der Steinboden zeigt helle Platten mit dünnen Fugen und harten Highlights,
ebenfalls mit einem acht Pixel breiten Rapport. Alle vier Bodenarten sind
horizontal und vertikal wiederholbar und haben keine Außenrahmen an den
Schnittkanten.

Backstein, Holzpaneele und die grüne Wand mit unterer Holzlambris haben
periodische Fugen. Sie wiederholen horizontal. Alle vier Wandarten übernehmen
die Zeilen 0–3 und 29–31 der vorhandenen `wall-plain` pixelgleich, damit
obere Abschlussleiste und Sockelleiste durchlaufen. Die Wände werden nicht
vertikal wiederholt.

Die Glaswand hat einen schmalen graublauen Rahmen, Cyanflächen und zwei
weiße Reflexlinien von jeweils neun nativen Pixeln. Ihre Mitte enthält
152 vollständig transparente Pixel. Rahmen, Glasfarbflächen und Reflexe
sind vollständig deckend. Es gibt keine Zwischenwerte beim Alpha und keine
bereits eingerechnete Hintergrundfarbe; den Raum hinter dem Glas zuerst zeichnen.

## Läufer aus neun Teilen

`nineSlice.runner` folgt dem vorhandenen `nineSlice.rug`-Format:
`tileSize: 16`, `borderPixels: 3`, `minimumTiles: [3,3]` und `parts` als
3×3-Matrix aus den neun `runner-*`-Namen.

Für einen Läufer mit w×h Kacheln die vier Ecken einmal zeichnen, die
Randmitten zwischen den Ecken wiederholen und die übrige Fläche mit
`runner-center` füllen. Die Teile werden wiederholt, nicht skaliert.
Alle Schnittkanten passen zueinander. Nur der äußere Rand besitzt die
Navy-Kontur und die dünne goldene Linie. Die obere und linke Goldkante
sind etwas heller als die untere und rechte.

Die Mindestgröße beträgt 48 × 48 native Pixel. Geprüfte Kachelgrößen sind
3×3, 3×9, 9×3, 4×12, 11×4 und 7×5. Der Prüfaufbau bleibt bei jeder Größe
vollständig deckend, ohne Zwischenrahmen, mit durchgehendem Goldrand.
`assemble_runner(atlas, sprites, width, height)` in `tools/prepare_stufe2_d.py`
liefert dafür ein RGBA-Array aus den tatsächlichen Atlas-Ausschnitten.

## Prüfbilder und Bericht

- `art/checks/stufe2-d-sprites.png`: alle 17 neuen Sprites **exakt 3×** auf
  neutralem Grund, mit Namen und Maßen; Läuferteile als 3×3-Gruppe.
- `art/checks/stufe2-d-tiling.png`: vier wiederholte Bodenflächen, vier
  Wandstreifen und drei Läufergrößen, alle **3×**.
- `art/checks/stufe2-d-room.png`: vier eingerichtete Bereiche mit den neuen
  Boden- und Wandarten und einem Läufer mit 4×12 Kacheln; **3×**.
- `art/checks/stufe2-d-quality.json`: aktueller Prüfbericht.

Geprüft werden native Maße, Palette, Alpha 0/255, Atlasgrenzen und Belegung,
transparente Leerfelder, begehbare Bodenbeläge, Wandpositionen und Kollisionen,
periodische Übergänge, identische Teppichmuster, durchgehende Läuferränder,
Leistenanschlüsse, klare Glasbereiche und die tatsächlichen Vorschaupixel.
Die bisherigen Prüfberichte und Anleitungen bleiben enthalten.

## Erneut erstellen

Python 3, Pillow und NumPy gemäß `tools/requirements.txt`:

```bash
python3 -m pip install -r tools/requirements.txt
python3 tools/prepare_stufe2_d.py
```

Das Skript baut zuerst Stufe 1, A, B1, C und B2 und ergänzt D. Für den aktuellen
Gesamtstand **prepare_stufe2_d.py** verwenden. Ältere Skripte erzeugen jeweils
nur ihren damaligen Atlasstand.

## Rohbild, Prompt und Nachbearbeitung

Ein Rohbild wurde mit der integrierten Bildgenerierung erstellt und liegt
unverändert unter `art/raw/stufe2-d-surfaces.png` (1254 × 1254 px).
Der genaue Prompt steht in `art/prompts/stufe2-d-surfaces.txt`. Referenzen
waren der freigegebene Stil-Anker und `art/references/walls-8x.png`.

`art/stufe2-d-source.json` dokumentiert Prüfsummen, Ausschnitte, Zielmaße,
Materialpaletten und Korrekturen. Python reduziert auf native Pixel und feste
Farben, vereinheitlicht den Teppichrapport und die periodischen Fugen,
entfernt innere Rahmen an den Läuferschnitten und richtet dessen Goldrand aus.
Die Glasmitte wird binär freigestellt; Reflexlinien und Leisten werden auf
native Pixel ausgerichtet. Die neun im Rohbild getrennten Läuferfelder
werden einzeln beschnitten und zu einem zusammenpassenden Satz bereinigt.

`art/references/stufe2-b2-atlas.json` und `art/stufe2-b2-assets.json` dokumentieren
den Stand vor D. Der Fortschritt steht in `art/stufe2-progress.json`, der
vollständige Auftrag in `docs/auftrag-stufe-2.md`, ältere Anleitungen in `docs/`.
Das ZIP enthält Assets und Skripte für den späteren Einbau in den Prototyp.
Die Raumdarstellung ist eine Prüfmontage aus dem Atlas.

## Nächste Pakete

Reihenfolge: **F → G → E**.
Als Nächstes folgt **F: Neue Bewegungen für look-01 und look-02**.
