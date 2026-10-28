# Pixel-Büro – Böden, Wände und Türen

Das Paket enthält **29 fertige Bausteine** mit einem gemeinsamen Atlas. Die 14 vorhandenen Boden- und Teppichkacheln sind unverändert enthalten. Dazu kommen sieben Wandteile, sechs Türbilder und zwei leere Schilder.

| Gruppe | Teile | Größe eines Teils | Bild |
| --- | ---: | --- | --- |
| Böden und Teppich | 14 | 16 × 16 px | `tiles/floor.png`, 80 × 64 px |
| Rückwand, Täfelung, linker und rechter Abschluss | 4 | 16 × 32 px | `tiles/walls.png`, 64 × 48 px |
| Seitenwandkappe, Außen- und Innenecke | 3 | 16 × 16 px | ebenfalls `tiles/walls.png` |
| Holztür und Glastür, jeweils zu / halb offen / offen | 6 | 16 × 32 px | `tiles/doors.png`, 48 × 80 px |
| Türschild und Messingschild, beide leer | 2 | 16 × 8 px | ebenfalls `tiles/doors.png` |

Alle sichtbaren Pixel verwenden ENDESGA 32. Alpha ist ausschließlich 0 oder 255; es gibt keine weichen Ränder, Zwischenfarben oder Beschriftungen in den Spielgrafiken.

## Ins Projekt übernehmen

Den vollständigen Ordner `public/assets/office/` in denselben Pfad des Zielprojekts kopieren. Er enthält alle drei PNGs und die zusammengeführte `atlas.json` mit Schema-Version 2. Die Positionen und Größen beziehen sich auf die Originalpixel; die Anzeige erfolgt dreifach.

```js
ctx.imageSmoothingEnabled = false;
const sprite = atlas.sprites['door-wood-half-open'];
ctx.drawImage(
  images[sprite.image],
  sprite.x, sprite.y, sprite.width, sprite.height,
  x, y, sprite.width * 3, sprite.height * 3
);
```

`images` enthält die zuvor geladenen PNGs, zugeordnet über die Pfade aus `atlas.meta.images`. `x` und `y` sind ganzzahlige Zielkoordinaten. Bei einer zusätzlichen CSS-Skalierung `image-rendering: pixelated` setzen.

## Wände zusammensetzen

- `wall-plain` und `wall-wainscot` sind horizontal wiederholbar. Es gibt keine senkrechte dunkle Kontur an ihren Schnittkanten.
- `wall-end-left` und `wall-end-right` schließen eine Rückwand ab; ihre inneren Kanten passen an die normale Putzwand.
- Oberkante und Sockelleiste stimmen zwischen Putz und Täfelung überein.
- `wall-side-cap` enthält links einen 4 Pixel breiten Streifen; die übrigen 12 Pixel seiner 16 × 16 großen Zelle sind transparent. Die rechte Seite wird im Code gespiegelt.
- `wall-outer-corner` liegt oben und links in seiner Zelle, `wall-inner-corner` unten und rechts. Für andere Ausrichtungen können die Ecken im Code gespiegelt oder um 90 Grad gedreht werden.

Die Grundposition eines Rückwand- oder Türbilds liegt an seiner Unterkante: `anchor: [0, 32]`. Die dünnen Seitenwandkappen sind als eigene Ebene über dem Boden gedacht.

## Türen animieren

`atlas.animations['door-wood']` und `atlas.animations['door-glass']` beschreiben jeweils eine Zeile mit drei Bildern. `states` nennt die zugehörigen Einträge unter `sprites`.

| Index | Zustand | `blocksMovement` |
| ---: | --- | --- |
| 0 | geschlossen | `true` |
| 1 | halb offen | `true` |
| 2 | vollständig offen | `false` |

Die Metadaten setzen 150 ms je Übergang und `loop: false`. Zum Schließen die Bilder rückwärts abspielen. Die Laufzeit wertet `blocksMovement` aus; Bildtransparenz ist keine Kollisionsmaske. Rahmen, Scharnierseite und Unterkante bleiben über alle Zustände gleich. Der Türflügel bleibt innerhalb der 16 × 32 großen Zelle.

Schilder heißen `plate-door` und `plate-brass`. Ihre Texte werden separat vom Code gezeichnet.

Der dehnbare Teppich steht unverändert unter `nineSlice.rug`. Details zu den Böden und der Korrektur des Teppichrasters stehen in `docs/floors.md`.

## Vorschauen und Prüfungen

- `checks/architecture-preview.png`: Montage mit Boden und Teppich, Wandstücke, wiederholte Wandsegmente und alle Türzustände in exakt dreifacher Größe.
- `checks/door-animation.gif`: Beide Türen öffnen und schließen synchron; die Endzustände werden für die Betrachtung länger gehalten.
- `checks/floor-preview.png`: Die einzelnen Böden und Teppichgrößen.
- `checks/architecture-quality.json` und `checks/floor-quality.json`: Ergebnisse der technischen Prüfungen.

Geprüft werden Maße, Palettenfarben, Alpha, Atlasgrenzen und Überlappungen, Wandanschlüsse, Kappenverbindungen, gleiche Rahmen und Unterkanten sowie eine mit jedem Öffnungszustand wachsende Türöffnung. Die GIF-Bilder werden nach dem Export gegen die entsprechenden Atlasbilder geprüft. Die Vorschauen enthalten Beschriftungen aus dem Code; die Spiel-PNGs bleiben textfrei.

## Wiederholbar bauen

```sh
python3 -m pip install -r tools/requirements.txt
python3 tools/prepare_room.py
```

Dieser Gesamtbefehl baut zuerst die Böden und danach Wände, Türen und den gemeinsamen Atlas. `tools/prepare_floors.py` ist die darin verwendete Bodenstufe; allein ausgeführt erzeugt sie nur den Bodenatlas.

Die Bereinigung benötigt keinen API-Zugriff. Sie prüft die SHA-256-Werte und Abmessungen der enthaltenen Originalbilder, reduziert Farben ohne Dithering und verwirft transparente Randreste. Wiederholbare Wandflächen und Holzverkleidungen werden auf ein gemeinsames Raster gebracht; dünne Konturen, Türfüllungen und Reflexe werden im Zielraster geschlossen und vereinfacht. Das verhindert Streupixel und springende Türrahmen.

## Quellen im Paket

Die Rohbilder liegen unverändert unter `art/raw/`, der freigegebene zweite Stil-Anker unter `art/style-anchor.png`. `art/architecture-source.json` und `art/floor-source.json` halten Zuschnittkoordinaten und Prüfsummen fest. `art/prompts/walls.txt` und `art/prompts/doors.txt` enthalten die tatsächlich verwendeten Prompts. Wände und Türen wurden mit der integrierten Bildgenerierung und dem freigegebenen Anker als Referenz erzeugt und anschließend technisch bereinigt.

Als nächster Baustein folgen Arbeitsplätze und Kaffeeecke. Möbel, Figuren, Wegfindung und die Canvas-Laufzeit gehören noch nicht zu diesem Paket.
