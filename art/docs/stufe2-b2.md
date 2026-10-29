# Pixel-Büro · Stufe 2 · A + B1 + C + B2

Kumulatives Grafikpaket mit **206 Sprites und 29 Animationen**.
B2 ergänzt 14 Spritebilder für Drucker, Server, Mülleimer, Stehlampen,
Sitzsack und Fußmatte. Stufe 1, A, B1 und C bleiben vollständig enthalten.

## Neue Grafik und Atlas

`public/assets/office/decor/decor-b.png` ist ein gepacktes Blatt mit
**64 × 112 nativen Pixeln**. Zum Zeichnen die einzelnen Atlas-Ausschnitte
verwenden; unbenutzte Bereiche bleiben transparent.

| Sprites | Native Größe | Grundfläche | An der Wand | Blockiert |
| --- | --- | --- | --- | --- |
| `printer-idle`, `printer-1` bis `printer-3` | je 16 × 24 | 1 × 1 | ja | ja |
| `server-0` bis `server-3` | je 16 × 32 | 1 × 1 | ja | ja |
| `trash-bin`, `trash-bin-full` | je 16 × 16 | 1 × 1 | nein | ja |
| `floor-lamp-off`, `floor-lamp-on` | je 16 × 32 | 1 × 1 | nein | ja |
| `beanbag` | 16 × 16 | 1 × 1 | nein | ja |
| `doormat` | 16 × 16 | 1 × 1 | nein | **nein** |

Alle neuen Objekte haben `placement: "floor"`, `frames: 1` und den Anker
`[0, height]` an der linken unteren Ecke. Der Sitzsack hat zusätzlich einen
Sitzplatz: `spots: [{name: "seat", dx: 8, dy: -1, facing: "front"}]`.
Der Fußpunkt liegt relativ zur linken unteren Spriteecke; negative dy-Werte
liegen oberhalb der unteren Kante. Passende Figurenposen folgen in Paket F.

Der Atlas bleibt bei `meta.schemaVersion: 2`. Ein Bild, 14 Sprites und zwei
Animationen ergänzen den Bestand. Alle **192 bisherigen Spriteeinträge**, alle
27 bisherigen Animationen und die übrigen bisherigen Metadaten sind unverändert.
Alle **24 vorherigen PNG-Dateien sind bytegleich** erhalten.

## Animationen und Zustände

| Animation | Zustände | Dauer je Bild | Schleife |
| --- | --- | --- | --- |
| `printer-print` | `printer-idle`, `printer-1`, `printer-2`, `printer-3` | 200 ms | **nein** |
| `server-blink` | `server-0` bis `server-3` | 180 ms | ja |

Der Drucker startet im Leerlauf. Danach wächst ein leeres weißes Blatt in drei
Stufen um 2, 4 und 6 native Pixel aus dem vorderen Ausgabeschlitz. Drucker und
Unterschrank bleiben pixelgleich. Die Animation endet mit ausgegebenem Blatt;
der aufrufende Code kann anschließend wieder `printer-idle` setzen.
Die Grafiken enthalten keine Texte, Zeichenfolgen, Zahlen oder Logos.

Der Serverschrank hat fünf klar getrennte Einheiten und jeweils genau einen
Statuspixel. Die Farben wechseln zwischen Grün, Cyan, Gelb und dunklem Grau
für eine ausgeschaltete LED. Nur diese fünf Pixel unterscheiden die vier Bilder.
Gehäuse, Einschübe und Silhouette bleiben identisch.

Leerer und voller Mülleimer teilen denselben Behälter. Nur die darübergelegten
zerknüllten Papierformen ändern das Bild. Die beiden Stehlampen haben exakt
identische Form, Stange und Fuß. Nur die drei Stofffarben des Schirms ändern
sich von Beige zu warmem Gelb; es gibt keinen Lichtkegel oder Lichtschein.

## Prüfbilder und Bericht

- `art/checks/stufe2-b2-sprites.png`: alle 14 neuen Sprites **exakt 3×**, auf
  neutralem Grund und je Reihe unten ausgerichtet.
- `art/checks/stufe2-b2-room.png`: Drucker, Server, beide Lampen, beide Mülleimer,
  Sitzsack und Fußmatte zusammen mit A, B1, C und vorhandenen Figuren; **3×**.
- `art/checks/stufe2-b2-animation.gif`: beide Animationen **3×** mit ihren echten
  200/180-ms-Zeiten. Der Drucker läuft einmal durch und hält das letzte Bild.
  Die 3600-ms-Demonstration startet beim nächsten GIF-Durchlauf erneut.
- `art/checks/stufe2-b2-quality.json`: aktueller Prüfbericht.

Geprüft werden native Maße, ENDESGA 32, Alpha 0/255, geschlossene Navy-Konturen,
untere Ausrichtung, Atlasgrenzen, überlappungsfreie Belegung, transparente
Leerfelder, Grundflächen, Kollisionen, Wandanschlüsse, begehbare Fußmatte,
Gehäusestabilität, fünf einzelne LED-Pixel, leeres Papier, Lampenform und die
Pixel der tatsächlichen Vorschauen einschließlich GIF-Farben und Bilddauern.
Die früheren Prüfberichte und Anleitungen bleiben enthalten.

## Erneut erstellen

Python 3, Pillow und NumPy gemäß `tools/requirements.txt`:

```bash
python3 -m pip install -r tools/requirements.txt
python3 tools/prepare_stufe2_b2.py
```

Das Skript baut zuerst Stufe 1, A, B1 und C und ergänzt dann B2. Für den aktuellen
Gesamtstand **prepare_stufe2_b2.py** verwenden. Ältere Skripte erzeugen jeweils
ihren damaligen Atlasstand.

## Rohbild, Prompt und Nachbearbeitung

Ein Rohbild wurde mit der integrierten Bildgenerierung erstellt und liegt
unverändert unter `art/raw/stufe2-b2-tech.png` (1254 × 1254 px).
Der genaue Prompt steht in `art/prompts/stufe2-b2-tech.txt`. Referenzen waren
der freigegebene Stil-Anker und `art/references/furniture-8x.png`.

`art/stufe2-b2-source.json` dokumentiert Prüfsummen, Ausschnitte, Zielmaße,
Materialpaletten und Korrekturen. Python reduziert auf native Pixel und binäre
Transparenz, schließt Konturen und richtet die Bilder unten aus. Bei den
Animationsgruppen wird jeweils ein festes Gehäuse übernommen; nur Papier,
einzelne LED-Pixel beziehungsweise Stofffarben werden geändert. Die fünf
Serverfronten und kleinen Papierformen werden auf das native Raster bereinigt.

`art/references/stufe2-c-atlas.json` und `art/stufe2-c-assets.json` dokumentieren
den Stand vor B2. Der Fortschritt steht in `art/stufe2-progress.json`, der
vollständige Auftrag in `docs/auftrag-stufe-2.md`, ältere Anleitungen in `docs/`.
Das ZIP liefert die Assets und Skripte für den späteren Einbau in den Prototyp;
die Raumdarstellung ist eine Prüfmontage aus dem Atlas.

## Nächste Pakete

Reihenfolge: **D → F → G → E**.
Als Nächstes folgt **D: Böden und Wände**.
