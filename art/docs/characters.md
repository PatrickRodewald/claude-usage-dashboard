# Pixel-Büro – zwei Grundfiguren

Dieses Gesamtpaket enthält **59 Bausteine**. Zu den bisherigen 53 Elementen kommen zwei Figuren mit jeweils drei Standansichten hinzu. Die fünf vorhandenen Tür- und Einrichtungsanimationen bleiben enthalten.

## Die Figuren

| Figur | Rolle | Aussehen | Kleidung |
| --- | --- | --- | --- |
| `look-01` | Hauptsitzung | Dunkle Haut, kurze schwarze Locken, runde Brille | Weste über hellem Hemd |
| `look-02` | Subagent | Helle Haut, kurze braune Haare, roter Bart | T-Shirt |

Jedes Figurenblatt ist **48 × 32 Pixel** groß. Es enthält ohne Zwischenräume drei Zellen à **16 × 32 Pixel**: vorn, hinten, rechts. Die linke Ansicht wird später im Code aus der rechten gespiegelt.

Alle sechs Ansichten haben dieselbe Fußlinie an der unteren Zellkante (`feetBaseline: 32`) und denselben Anker `[8, 32]`. Der Kopf einschließlich Haaren belegt ungefähr elf Pixel und damit etwa ein Drittel der Figur. Die Außenkontur liegt in tiefem Navy; Alpha ist ausschließlich 0 oder 255. Alle sichtbaren Farben stammen aus ENDESGA 32.

## Dateien

| Pfad unter `public/assets/office/` | Inhalt |
| --- | --- |
| `characters/look-01/sheet.png` | Hauptsitzung: vorn, hinten, rechts |
| `characters/look-02/sheet.png` | Subagent: vorn, hinten, rechts |
| `characters/look-01/recolor-mask.png` | Weiße Pixel markieren die umfärbbare Weste |
| `characters/look-02/recolor-mask.png` | Weiße Pixel markieren das umfärbbare T-Shirt |
| `atlas.json` | Alle 59 Einträge, die beiden Figurenbeschreibungen und die bisherigen Animationen |

Die bisherigen fünf PNG-Atlanten für Böden, Wände, Türen, Arbeitsplätze und Kaffeeecke sind unverändert enthalten. Den vollständigen Ordner `public/assets/office/` in denselben Pfad des Zielprojekts kopieren.

## Zeichnen und Anker

Die Einzelbilder heißen `look-01-front`, `look-01-back`, `look-01-right` beziehungsweise `look-02-front`, `look-02-back`, `look-02-right`. `atlas.characters` ordnet sie nach Rolle und Blickrichtung zu und nennt die Farbmasken.

```js
ctx.imageSmoothingEnabled = false;
const sprite = atlas.sprites['look-01-front'];
const scale = 3;
ctx.drawImage(
  images[sprite.image],
  sprite.x, sprite.y, sprite.width, sprite.height,
  groundX - sprite.anchor[0] * scale,
  groundY - sprite.anchor[1] * scale,
  sprite.width * scale, sprite.height * scale
);
```

`groundX` und `groundY` bezeichnen den Fußpunkt in ganzzahligen Bildschirmpixeln. `images` ordnet die geladenen PNGs nach den Pfaden aus `atlas.meta.images` zu. Bei einer zusätzlichen CSS-Vergrößerung `image-rendering: pixelated` verwenden.

Eine Figur belegt auf dem späteren Bewegungsraster eine Bodenkachel (`footprintTiles: [1, 1]`); ihre Darstellung ist zwei Kacheln hoch. Bei Richtungswechseln bleibt der Fußpunkt fest. Nach links wird das rechte Einzelbild samt Farbmaske gespiegelt; sein mittiger Anker bleibt gleich.

## Farbtausch

Die drei Schlüsselfarben kommen in den Figurenblättern ausschließlich in Weste und T-Shirt vor:

| Ton | Original | Beispiel Grün | Beispiel Rot |
| --- | --- | --- | --- |
| Hell | `#2ce8f5` | `#63c74d` | `#f6757a` |
| Mittel | `#0099db` | `#3e8948` | `#e43b44` |
| Dunkel | `#124e89` | `#265c42` | `#a22633` |

Jede der sechs Ansichten verwendet alle drei Töne. Haut, Haare, Brille, helles Hemd, Hose, Schuhe und Konturen bleiben beim Farbtausch pixelgenau unverändert.

Beim Ersetzen immer die ursprünglichen Pixel vergleichen, damit eine Ersatzfarbe nicht im selben Durchlauf erneut ersetzt wird. Der Farbtausch gilt nur für Figurenbilder; die vorhandenen Möbel und Bildschirme verwenden dieselben Blautöne für andere Materialien.

Die enthaltene Python-Funktion `recolor` in `tools/prepare_characters.py` führt diesen Farbtausch durch und wird für die Prüfungen und Vorschauen verwendet. Die Masken sind nicht erforderlich, um exakte Schlüsselfarben auszutauschen, helfen aber beim Prüfen oder beim maskierten Zeichnen. Sie haben jeweils dieselben 48 × 32 Pixel wie das zugehörige Figurenblatt.

## Vorschauen und Prüfungen

- `checks/characters-preview.png`: Alle sechs Ansichten und zwei Beispiele für den Farbtausch. Figuren exakt dreifach ohne Glättung; die grauen Karten gehören ausschließlich zur Prüfansicht.
- `checks/characters-in-room.png`: Beide Figuren stehend im eingerichteten Büro, im echten Größenverhältnis zu Boden und Möbeln.
- `checks/characters-quality.json`: Maße, Palettenfarben, Alpha, Atlaspositionen, Fußlinie, Schlüsselfarben und Farbmasken. Für beide Farbbeispiele werden sämtliche Pixel außerhalb der Kleidung auf Gleichheit geprüft.
- Die bisherigen Vorschauen und Berichte für Böden, Architektur und Einrichtung bleiben im Paket.

Die Brillenreflexe und der rote Bart werden auch nach der Verkleinerung auf vorhandene Pixel geprüft; die Lesbarkeit wurde zusätzlich in der Vorschau kontrolliert. Die Brillenränder wurden im kleinen Raster gezielt geschlossen. Beschriftungen stehen nur in den vom Code erzeugten Prüfansichten, nicht in den Spielgrafiken.

## Wiederholbar bauen

```sh
python3 -m pip install -r tools/requirements.txt
python3 tools/prepare_characters.py
```

Der Gesamtbefehl baut zuerst die bestehenden Bausteine, ergänzt danach die Figuren und schreibt den vollständigen Atlas. Die älteren Skripte sind Zwischenstufen; einzeln ausgeführt erzeugen sie nur ihren jeweiligen Stand. Für die Bereinigung ist kein API-Zugriff nötig.

Die unveränderten Rohbilder liegen unter `art/raw/look-01.png` und `art/raw/look-02.png`. Die tatsächlich verwendeten Prompts stehen in `art/prompts/look-01.txt` und `art/prompts/look-02.txt`. Erzeugt wurden die Bilder mit der integrierten Bildgenerierung und dem freigegebenen Stil-Anker als Referenz; die zweite Figur nutzt zusätzlich die erste als Stil- und Maßstabsreferenz.

`art/characters-source.json` enthält die Prüfsummen, Zuschnitte und die Aufteilung in Kopf, Oberkörper und Beine. Die Bereinigung normalisiert die größeren Quellproportionen auf das Zielraster, reduziert Farben ohne Dithering, schließt Konturen und hält die drei Ansichten einer Figur auf einem gemeinsamen horizontalen Maßstab. Die Farbmasken werden aus den fertigen Schlüsselfarben abgeleitet und geprüft.

Weitere Einzelheiten zu den bisherigen Bausteinen stehen in `docs/floors.md`, `docs/architecture.md` und `docs/furniture.md`.

Die Grundfiguren dienen als Referenz für die nächste Stufe. Geh- und Arbeitsanimationen werden danach mit den abgestimmten Figuren erstellt.
