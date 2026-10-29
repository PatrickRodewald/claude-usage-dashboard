# Pixel-Büro – Geh- und Arbeitsanimationen

Das Gesamtpaket enthält **118 Atlas-Einträge und 23 Animationen**. Neu sind 52 Figurenframes für die beiden freigegebenen Looks sowie sieben separate Buch- und Notizblockbilder. Die bisherigen Bausteine und Grundfiguren bleiben unverändert enthalten.

## Neue Figurenanimationen

Die folgenden acht Abläufe stehen für `look-01` und `look-02` zur Verfügung:

| Suffix des Animationsnamens | Bilder | Zeit je Bild | Verhalten |
| --- | ---: | ---: | --- |
| `walk-front` | 4 | 120 ms | Gehen zum Betrachter |
| `walk-back` | 4 | 120 ms | Gehen vom Betrachter weg |
| `walk-right` | 4 | 120 ms | Gehen nach rechts |
| `idle` | 2 | 700 ms | Stehen, kleine Schulterbewegung beim Atmen |
| `type` | 3 | 160 ms | Sitzen und tippen |
| `read` | 3 | 220 ms | Lesen mit Umblättergeste |
| `write` | 3 | 160 ms | Schreiben |
| `think` | 3 | 500 ms | Hand ans Kinn, aufblicken, Kopf kratzen |

Die vollständigen Namen lauten beispielsweise `look-01-walk-right` und `look-02-read`. Alle Abläufe wiederholen sich (`loop: true`). Die linken Gehbilder werden im Code aus `walk-right` gespiegelt; dafür steht `mirrorWalkLeftFrom` im jeweiligen Eintrag unter `characters`.

Jedes Figurenbild ist **16 × 32 Pixel** groß und verwendet den Anker `[8, 32]`. Die Kontaktlinie zum Boden liegt an der unteren Zellkante. Im Gehen gibt es vier unterschiedliche Beinposen pro Richtung; Kopf und Gesicht entsprechen pixelgenau der freigegebenen Blickrichtung. Im Stehen bewegen sich die äußeren Schultergruppen um einen Pixel, Kopf und Füße bleiben fest.

Die Arbeitsbilder enthalten bereits den Stuhl. Seine untere Basis und die sitzenden Füße bleiben in allen zwölf Arbeitsframes einer Figur unverändert. Die Kopfposition wird beim Lesen leicht gesenkt und beim Aufblicken leicht angehoben; Haar- und Gesichtsform kommen weiterhin aus dem freigegebenen Grundbild.

## Dateien

| Pfad unter `public/assets/office/` | Größe | Anordnung |
| --- | --- | --- |
| `characters/look-01/walk.png` | 64 × 128 px | Vier Zeilen: vorn, hinten, rechts, atmen |
| `characters/look-02/walk.png` | 64 × 128 px | Gleiche Anordnung |
| `characters/look-01/desk-work.png` | 48 × 128 px | Vier Zeilen: tippen, lesen, schreiben, denken |
| `characters/look-02/desk-work.png` | 48 × 128 px | Gleiche Anordnung |
| `characters/look-01/walk-recolor-mask.png` | 64 × 128 px | Farbmaske zum Gehblatt |
| `characters/look-02/walk-recolor-mask.png` | 64 × 128 px | Farbmaske zum Gehblatt |
| `characters/look-01/desk-work-recolor-mask.png` | 48 × 128 px | Farbmaske zum Arbeitsblatt |
| `characters/look-02/desk-work-recolor-mask.png` | 48 × 128 px | Farbmaske zum Arbeitsblatt |
| `characters/look-01/desk-work-hands.png` | 48 × 128 px | Hände und unmittelbare Kontur als Vordergrund |
| `characters/look-02/desk-work-hands.png` | 48 × 128 px | Gleiche Anordnung wie das Arbeitsblatt |
| `props/work-a.png` | 64 × 32 px | Oben vier Buchbilder, unten drei Notizblockbilder |

Die letzten zwei Felder der Atemzeile und das letzte Feld der Notizblockzeile sind transparent. Es gibt keine Zwischenräume zwischen den belegten Zellen. Alle Positionen stehen in `atlas.json`; alle Hauptbilder stehen unter `meta.images`, neue Masken und Handbilder unter `auxiliaryImages`.

Den vollständigen Ordner `public/assets/office/` in denselben Pfad des Zielprojekts übernehmen. Die bisherigen fünf Umgebungsatlanten und die beiden Grundfigurenblätter sind unverändert enthalten.

## Animation abspielen

```js
const animation = atlas.animations['look-01-walk-front'];
const index = Math.floor(elapsedMs / animation.frameDurationMs) % animation.frames;
const sprite = atlas.sprites[animation.states[index]];
ctx.imageSmoothingEnabled = false;
ctx.drawImage(
  images[sprite.image],
  sprite.x, sprite.y, sprite.width, sprite.height,
  groundX - sprite.anchor[0] * 3,
  groundY - sprite.anchor[1] * 3,
  sprite.width * 3, sprite.height * 3
);
```

Auf ganzzahlige Zielpixel zeichnen. `groundX` und `groundY` sind der Fußpunkt. Das Bodenraster ist 16 × 16 Pixel; Figuren sind zwei Kacheln hoch und belegen eine Bodenkachel. Die tatsächliche Bewegung des Fußpunkts durch den Raum ergänzt die spätere Laufzeit.

## Requisiten und Handebene

Buch, Notizblock und Laptop sind getrennte Bilder. Dafür wurden die ersten beiden Requisiten aus Gruppe A vorgezogen; Lupe, Terminal und Testkolben gehören noch nicht zu diesem Teil von `work-a.png`.

| Ablauf | Requisit | Zuordnung der drei Figurenframes |
| --- | --- | --- |
| `type` | vorhandenes `laptop-back-open` | statisches Bild |
| `read` | `book-page-turn` | Buchbilder 0, 1, 3 |
| `write` | `notepad-write` | Notizblockbilder 0, 1, 2 |
| `think` | keines | freie Handgesten |

Das Buch hat insgesamt vier Bilder mit umblätternder Seite. Der Notizblock hat drei Bilder mit einer, zwei und drei kurzen grauen Linien sowie versetztem Stift. Die beiden eigenständigen Animationen heißen `book-page-turn` und `notepad-write` und haben jeweils 180 ms pro Bild. Die Buchunterkante bleibt über alle vier Bilder gleich. Die genannten Zuordnungen verbinden sie mit den drei Figurenphasen; alle vier Buchbilder sind auch unabhängig nutzbar.

Unter `animation.prop` stehen Requisit beziehungsweise Requisitenanimation, `frameMap` und `mount: [0, 12]`. Dieser Versatz bezeichnet die obere linke Ecke des Requisits relativ zur oberen linken Ecke der Figur, in Originalpixeln.

Beim Zusammensetzen eines Arbeitsplatzes in dieser Reihenfolge zeichnen:

1. Figurenframe einschließlich Stuhl.
2. Schreibtisch vor dem Unterkörper.
3. Requisit am angegebenen Auflagepunkt.
4. Passenden Ausschnitt aus `foregroundImage` an derselben Position wie die Figur.

Der Ausschnitt für die Handebene verwendet die gleichen x/y-Koordinaten und Maße wie der Figurenframe. Damit liegen die Hände vor Buch oder Papier. Der Stuhl wird bereits mit dem Figurenframe gezeichnet; ein zweites Stuhlbild ist dort nicht nötig. `checks/work-at-desks.gif` zeigt diese Reihenfolge für beide Looks und alle vier Tätigkeiten.

## Palette und Farbtausch

Alle Spielgrafiken verwenden ausschließlich ENDESGA 32; Alpha ist nur 0 oder 255. Es gibt keine Glättung oder Zwischenfarben. Beschriftungen werden nur in Prüfansichten vom Code gezeichnet.

Die drei Schlüsselfarben `#2ce8f5`, `#0099db` und `#124e89` kommen in jedem Figurenframe vor und markieren ausschließlich Weste beziehungsweise T-Shirt. Masken sind weiß an diesen Stellen und sonst transparent. Haut, Haare, Brille, Hose, Schuhe, Stuhl und Handebene bleiben beim Farbtausch unverändert.

Den Farbtausch auf den Figurenframe anwenden, bevor separate Requisiten gezeichnet werden. Ein Laptop verwendet dieselben Blautöne für andere Materialien und wird unabhängig behandelt. Die bereits enthaltene Funktion `recolor` in `tools/prepare_characters.py` wird auch zum Prüfen der neuen Frames verwendet.

## Vorschauen und Prüfung

- `checks/animation-overview.gif`: Alle acht Figurenabläufe für beide Looks, auf neutralen Prüfkarten und exakt dreifach vergrößert.
- `checks/work-at-desks.gif`: Montage am Schreibtisch mit Requisiten und Handebene. Für die gemeinsame Betrachtung werden die Arbeitsframes hier jeweils 240 ms gehalten.
- `checks/animation-sheets.png`: Alle vier neuen Figurenblätter sowie Buch- und Notizblockbilder in dreifacher Größe.
- `checks/animation-quality.json`: Abschließender Prüfbericht mit 118 Einträgen und 23 Animationen.

Geprüft werden Maße, Palettenfarben, Alpha, Atlasgrenzen und Überlappungen, Schlüsselfarben und Masken, Farbtausch, konstante Gehköpfe, vier unterschiedliche Beinposen pro Richtung, bewegte Schultern beim Atmen sowie eine feste untere Stuhlbasis und Fußlinie im Sitzen. Die exportierten GIF-Bilder werden pixelgenau gegen die aus dem Atlas zusammengesetzten Bilder geprüft.

Die Prüfberichte der vorherigen Stufen bleiben erhalten und beziehen sich jeweils auf ihren früheren Zwischenstand. Für den aktuellen Gesamtstand gilt `animation-quality.json`.

## Wiederholbar bauen

```sh
python3 -m pip install -r tools/requirements.txt
python3 tools/prepare_animations.py
```

Der Gesamtbefehl baut alle bisherigen Stufen, ergänzt anschließend die Animationen und schreibt den vollständigen Atlas. Die älteren Skripte sind darin verwendete Zwischenstufen; einzeln ausgeführt erzeugen sie nur ihren jeweiligen Stand. Die Bereinigung benötigt keinen API-Zugriff.

Die fünf neuen Rohbilder liegen unverändert unter `art/raw/`; ihre tatsächlich verwendeten Prompts stehen unter `art/prompts/`. Erzeugt wurden sie mit der integrierten Bildgenerierung und den freigegebenen Figuren sowie dem Stil-Anker als Referenz. `art/references/` enthält die dafür achtfach mit Nearest Neighbor vergrößerten Grundfigurenblätter. Zuschnitte, Aufteilungen und Prüfsummen stehen in `art/animation-source.json`.

Die Bereinigung vereinheitlicht die Körperproportionen, Kopfpositionen und Anker. Beide Looks nutzen die klarere Schrittfolge der zweiten Gehvorlage für ihre gleichfarbigen Hosen und Schuhe; individuelle Köpfe, Kleidung, Haut und Armbewegungen bleiben erhalten. Die sitzenden Figuren verwenden eine gemeinsame feste Stuhl- und Beinbasis je Look, darüber die Gesten der jeweiligen Vorlage. Feine Details werden im Zielraster geschlossen oder vereinfacht.

Informationen zu den vorherigen Stufen stehen in `docs/floors.md`, `docs/architecture.md`, `docs/furniture.md` und `docs/characters.md`.

Als nächste Grafikgruppe für den Canvas-Prototyp folgen Sprechblasen und Emotes.
