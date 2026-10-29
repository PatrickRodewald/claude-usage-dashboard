# Pixel-Büro · Stufe 2 · Pakete A + B1

Das kumulative Paket enthält **178 Sprites und 25 Animationen**. Alle Inhalte
aus Stufe 1 und Paket A sind erhalten. Neu sind neun Pflanzen- und
Einrichtungsobjekte aus **Paket B1**.

## Neue B1-Sprites

Datei: `public/assets/office/decor/decor-a.png`, **64 × 96 px**.
Alle neuen Sprites verwenden `frames: 1` und `anchor: [0, height]`.

| Name | Größe | placement | footprintTiles | blocksMovement | againstWall |
| --- | --- | --- | --- | --- | --- |
| plant-tall | 16 × 32 | floor | [1, 1] | true | false |
| plant-bush | 16 × 24 | floor | [1, 1] | true | false |
| plant-palm | 16 × 32 | floor | [1, 1] | true | false |
| plant-desk | 8 × 12 | desk | – | – | – |
| cactus-desk | 8 × 12 | desk | – | – | – |
| bookshelf | 32 × 32 | floor | [2, 1] | true | true |
| bookshelf-low | 32 × 24 | floor | [2, 1] | true | true |
| filing-cabinet | 16 × 32 | floor | [1, 1] | true | true |
| coat-rack | 16 × 32 | floor | [1, 1] | true | false |

Die zwei Tischpflanzen sind die im Auftrag genannten Ausnahmen zur allgemeinen
Bodenplatzierung von B1. Sie haben keine Boden-Grundfläche und keine
Bodenkollision. Regale und Aktenschrank bekommen `againstWall: true`; die
freistehenden Pflanzen und die Garderobe benötigen keinen Wandanschluss.

Das große Regal hat drei Buchfächer und eine kleine Box. Das niedrige Regal hat
zwei Fächer und eine Pflanze auf der Oberseite. Der Aktenschrank hat drei
Schubladen mit jeweils einem kleinen, leeren Metallgriff. Buchrücken und
Behälter enthalten keinen Text.

## Atlas und Einbau

`public/assets/office/atlas.json` bleibt bei `meta.schemaVersion: 2`.
Das neue Bild steht unter `meta.images`; neun neue Namen ergänzen `sprites`.
Alle **169 bisherigen Spriteeinträge**, alle Animationen und die übrigen
bisherigen Metadaten sind unverändert.

Bodenobjekte werden über ihren unteren Anker platziert; ihre Grundflächen
belegen eine bzw. zwei Kacheln. Tischpflanzen werden relativ zur sichtbaren
Tischoberfläche montiert. Die Raummontage zeigt beide Pflanzen in den freien
rechten Tischbereichen, neben Laptop bzw. Buch.

Die B1-Datei ist gepackt: Pflanzen enden in Blattzeile 31, Regale in Zeile 63,
Aktenschrank und Garderobe in Zeile 95. Kleine Pflanzen und das niedrige Regal
sind innerhalb dieser Zeilengruppen unten ausgerichtet. Für den Einbau immer
die einzelnen Atlas-Ausschnitte verwenden.

Paket A bleibt in `decor/wall.png` erhalten. Seine Wandpositionen,
Schreibflächen, Uhrmittelpunkt und Fensterzustände sind in
`docs/stufe2-a.md` dokumentiert.

## Prüfbilder und Berichte

- `art/checks/stufe2-b1-sprites.png`: alle neun B1-Sprites **exakt 3×** auf
  neutralem Grund, unten ausgerichtet, mit Namen und Maßen.
- `art/checks/stufe2-b1-room.png`: alle neun neuen Objekte zusammen mit Paket A,
  bestehenden Möbeln und beiden Figuren; ebenfalls **3×**.
- `art/checks/stufe2-b1-quality.json`: aktueller Prüfbericht.
- Die A-Prüfbilder und der A-Bericht bleiben im gleichen Verzeichnis erhalten.

Geprüft wurden Maße, ENDESGA 32, ausschließlich Alpha 0/255, geschlossene
Navy-Konturen, untere Ausrichtung, überlappungsfreie Atlasbelegung,
Boden-Grundflächen, Kollisions- und Wandanschlussdaten, drei Blatt-Grüntöne,
Regalfächer, drei Schubladen und die tatsächlichen Vorschaupixel.
Alle **22 vorherigen Grafikdateien sind bytegleich** erhalten.

## Erneut erstellen

Python 3, Pillow und NumPy gemäß `tools/requirements.txt`:

```bash
python3 -m pip install -r tools/requirements.txt
python3 tools/prepare_stufe2_b1.py
```

Das Skript baut zuerst Stufe 1 und Paket A und ergänzt dann B1. Für den aktuellen
Gesamtstand immer **prepare_stufe2_b1.py** verwenden. Ältere Skripte allein
schreiben jeweils nur ihren damaligen Atlasstand.

## Rohbild, Prompt und Nachbearbeitung

Ein neues Rohbild wurde mit der integrierten Bildgenerierung erstellt.
Es liegt unverändert unter `art/raw/stufe2-b1-decor.png` (1254 × 1254 px).
Der vollständige Prompt steht in `art/prompts/stufe2-b1-decor.txt`.
Referenzen waren der freigegebene Stil-Anker und eine 8×-Montage vorhandener
Möbel und Figuren in `art/references/furniture-8x.png`.

`art/stufe2-b1-source.json` enthält Prüfsumme, Ausschnitte, Zielmaße und
Korrekturen. Die Python-Nachbearbeitung reduziert auf native Pixel, feste
Materialpaletten und binäre Transparenz. Holzrahmen werden getrennt von den
bunten Buchrücken quantisiert. Die Schubladenfronten und Griffe sind auf drei
klare Fächer ausgerichtet. Bei vier Pflanzen wurde jeweils ein Blattpixel
korrigiert, damit alle drei Blatt-Grüntöne erhalten bleiben.

`art/references/stufe2-a-atlas.json` und `art/stufe2-a-assets.json` dokumentieren
den unveränderten Stand vor B1. Der aktuelle Fortschritt steht in
`art/stufe2-progress.json`, der vollständige Auftrag in
`docs/auftrag-stufe-2.md`. Die Raummontage ist ein Prüfbild aus dem Atlas; das
ZIP liefert die Assets und Skripte für den späteren Einbau in den Prototyp.

## Nächste Pakete

Vorgesehene Reihenfolge: **C → B2 → D → F → G → E**.
Als Nächstes folgt **C: Lounge und Küche**.
