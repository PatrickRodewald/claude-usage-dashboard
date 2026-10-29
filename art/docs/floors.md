# Pixel-Büro – bereinigtes Bodenblatt

Dieses Paket enthält das erste nutzbare Boden-Asset-Set zum freigegebenen Stil-Anker.

- Fünf Bodenvarianten: Holz A, Holz B, Büroteppich, Küchenfliesen und Flurbelag.
- Neun Teile für einen dehnbaren Teppich: vier Ecken, vier Kanten und ein Mittelteil.
- Alle Teile sind **16 × 16 Pixel** groß. Das gemeinsame Atlasbild ist **80 × 64 Pixel** groß.
- Nur Farben aus ENDESGA 32; kein Dithering, keine Zwischenfarben, Alpha nur 0 oder 255.
- Die fünf Böden sind vollständig deckend. Beim Teppich sind nur die äußeren Eckpixel transparent.

## Für das Projekt

`public/assets/office/tiles/floor.png` und `public/assets/office/atlas.json` in dieselben Pfade des Zielprojekts kopieren. Die Positionen im JSON beziehen sich auf das unskalierte PNG. Unbelegte Felder im Atlas sind transparent.

Der Teppich wird aus den unter `nineSlice.rug.parts` genannten neun Teilen zusammengesetzt. Ecken bleiben unverändert; Kanten und Mitte werden bei größeren Teppichen wiederholt. Das kleinste unterstützte Format ist 3 × 3 Kacheln. Damit ist die widersprüchliche Angabe „3 × 2 Kacheln, neun Teile“ aus der Ausgangsvorlage korrigiert.

Für Canvas vor dem Zeichnen setzen:

```js
ctx.imageSmoothingEnabled = false;
const s = atlas.sprites['wood-a'];
ctx.drawImage(floorImage, s.x, s.y, s.width, s.height, x, y, 48, 48);
```

`x` und `y` müssen ganzzahlig sein. Bei CSS-Skalierung zusätzlich `image-rendering: pixelated` verwenden.

## Prüfansicht

`checks/floor-preview.png` zeigt jeden Boden als 3 × 3 Kacheln, die beiden Holzvarianten gemischt und den Teppich in zwei Größen. Alle Spielgrafiken sind dort exakt dreifach mit Nearest Neighbor vergrößert. Text in der Prüfansicht wird separat vom Code gezeichnet.

`checks/floor-quality.json` protokolliert Palette, Alpha, Maße, Atlasgrenzen, Anschlüsse der Holzvarianten sowie die Verbindungen und Wiederholungen der Teppichteile. Die Fliesenprüfung vergleicht den Übergang am Kachelrand mit dem entsprechenden inneren Übergang; zwei benachbarte Randpixel müssen bei einem periodischen Muster nicht zwangsläufig dieselbe Farbe haben.

## Wiederholbare Bereinigung

```sh
python3 -m pip install -r tools/requirements.txt
python3 tools/prepare_floors.py
```

Das Skript benötigt keinen API-Zugriff. Es liest ausschließlich das enthaltene Rohbild und dessen festgelegte Zuschnittkoordinaten. Der SHA-256-Wert schützt vor einer versehentlichen Verarbeitung eines anderen Bilds.

Die Bereinigung umfasst dominante Palettenfarben je Rasterfeld, feste Materialfarben, geschlossene Ränder und gezielte Korrekturen an der Geometrie: Holzfugen werden auf einen 4-Pixel-Rhythmus gebracht, die Küchenfliesen auf 4 × 4 Pixel große Quadrate und der Teppichrand auf 3 Pixel Breite. Das verhindert Lücken und ungleichmäßige Fugen. Details unterhalb eines logischen Pixels entfallen dabei; das Rohbild bleibt unverändert enthalten.

## Inhalt

| Pfad | Inhalt |
| --- | --- |
| `public/assets/office/tiles/floor.png` | Fertiges Atlasbild ohne Text |
| `public/assets/office/atlas.json` | Positionen, Maße und Teppichzuordnung |
| `checks/floor-preview.png` | Prüfansicht in dreifacher Größe |
| `checks/floor-quality.json` | Ergebnis der technischen Prüfungen |
| `tools/prepare_floors.py` | Bereinigung und Prüfung |
| `tools/requirements.txt` | Python-Abhängigkeiten |
| `art/raw/floor.png` | Unverändertes erzeugtes Boden-Rohbild |
| `art/style-anchor.png` | Freigegebener zweiter Stil-Anker |
| `art/floor-source.json` | Zuschnitte und Herkunft des Rohbilds |
| `art/palettes/endesga-32.gpl` | Farbpalette im GIMP-Palettenformat |

Wände, Türen, Möbel und Figuren sind der nächste Schritt und gehören noch nicht zu diesem Paket.
