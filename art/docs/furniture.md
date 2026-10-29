# Pixel-Büro – Arbeitsplätze und Kaffeeecke

Dieses Gesamtpaket enthält **53 Bausteine**: die bisherigen 29 Boden-, Wand- und Türelemente sowie 14 Arbeitsplatz- und 10 Küchenbilder. Der gemeinsame Atlas enthält alle Positionen, fünf Animationen und Auflagepunkte für das Tischzubehör.

## Neue Bausteine

| Elemente | Anzahl Bilder | Größe je Bild |
| --- | ---: | --- |
| Großer Schreibtisch | 1 | 48 × 24 px |
| Kleiner Schreibtisch | 1 | 32 × 24 px |
| Stuhl von hinten, vorn und rechts | 3 | 16 × 24 px |
| Laptop geschlossen, offen von hinten, offen von vorn | 3 | 16 × 16 px |
| Tischlampe aus und an | 2 | 16 × 16 px |
| Tasse ohne Dampf und drei Dampfbilder | 4 | 8 × 16 px |
| Küchentheke | 1 | 48 × 24 px |
| Espressomaschine: bereit, tropfend, Dampf, fertig | 4 | 16 × 24 px |
| Wasserspender mit aufsteigender Blase | 3 | 16 × 32 px |
| Kühlschrank | 1 | 16 × 32 px |
| Tablett mit zwei Tassen | 1 | 16 × 16 px |

Die beiden neuen Dateien liegen unter `public/assets/office/furniture/workplace.png` (80 × 96 px) und `public/assets/office/furniture/kitchen.png` (64 × 96 px). Beide haben echte Transparenz. Alle sichtbaren Farben gehören zu ENDESGA 32, Alpha ist nur 0 oder 255. Geschlossene Laptopdeckel sind ohne Logo; Bildschirme sind ohne Text.

Tische und Theke enthalten keine fest eingebauten Geräte. Das Zubehör bleibt getrennt und kann im Spiel ausgetauscht werden. Die neuen Bilder verwenden die gleiche Perspektive, Palette und logische Skalierung wie die bisherigen Bausteine.

## Ins Projekt übernehmen

Den vollständigen Ordner `public/assets/office/` in denselben Pfad des Zielprojekts kopieren. Die bisherigen drei PNGs sind unverändert enthalten; `atlas.json` ist um die neuen Einträge ergänzt.

```js
ctx.imageSmoothingEnabled = false;
const s = atlas.sprites['desk-large'];
ctx.drawImage(images[s.image], s.x, s.y, s.width, s.height,
              x, y, s.width * 3, s.height * 3);
```

`images` ordnet die geladenen PNGs nach ihren Pfaden aus `atlas.meta.images` zu. Auf ganze Zielpixel zeichnen. Bei CSS-Vergrößerung zusätzlich `image-rendering: pixelated` setzen.

Die Anker der neuen Bilder liegen links unten (`anchor: [0, height]`). `footprintTiles` beschreibt die Belegung auf dem späteren 16-Pixel-Bodenraster: großer Tisch und Theke drei Kacheln breit, kleiner Tisch zwei, Stühle, Kühlschrank und Wasserspender jeweils eine. Requisiten liegen auf ihren Trägern.

## Auflagepunkte

`atlas.mountPoints` enthält die Position der oberen linken Ecke eines Requisitenbilds relativ zur oberen linken Ecke des Tisch- oder Thekenbilds. Die Werte sind unskalierte Originalpixel und werden beim Zeichnen ebenfalls mit drei multipliziert.

| Träger | Requisit | Versatz x / y |
| --- | --- | --- |
| `desk-large` | Laptop | 16 / −4 |
| `desk-large` | Lampe | 1 / −5 |
| `desk-large` | Tasse | 36 / −2 |
| `desk-small` | Laptop | 8 / −4 |
| `desk-small` | Tasse | 24 / −2 |
| `kitchen-counter` | Espressomaschine | 0 / −16 |
| `kitchen-counter` | Tablett | 28 / −8 |

Negative y-Werte berücksichtigen die Höhe der aufrecht stehenden Objekte. Die Bildunterkante sitzt auf der Oberfläche. `surfaceBottomY` markiert die vordere Grenze der Tischplatte beziehungsweise Thekenoberfläche.

Für die Montage zunächst den Stuhl hinter dem Tisch zeichnen, danach den Tisch und anschließend das Zubehör. Die Raumvorschau verwendet diese Reihenfolge. Figuren kommen in der nächsten Stufe hinzu.

## Animationen und Zustände

| Atlas-Eintrag unter `animations` | Bilder | Intervall | Wiederholung |
| --- | ---: | ---: | --- |
| `mug-steam` | 3 | 160 ms | ja |
| `espresso` | 4 | 250 ms | nein |
| `cooler-bubble` | 3 | 220 ms | ja |

Die vorhandenen Animationen `door-wood` und `door-glass` bleiben enthalten. Jede Animation nennt ihre Einzelbilder in `states`; die Bilder liegen jeweils lückenlos nebeneinander im zugehörigen PNG.

`mug-idle` ist das separate Bild ohne Dampf. Die Tasse bleibt in allen vier Bildern gleich. Bei der Espressomaschine ändern sich nur Statuslicht, Kaffeeoberfläche, Strahl und Dampf. Beim Wasserspender steigt eine einzelne Blase von unten nach oben; Gehäuse, Flasche und Füße bleiben unverändert.

`stateGroups['desk-lamp']` nennt `lamp-off` und `lamp-on`. Nur die Glühfläche ändert ihre Farbe. Einen Lichtkegel kann später die Laufzeit zeichnen. Die drei Laptopansichten stehen unter `stateGroups.laptop`.

## Vorschauen und Prüfungen

- `checks/furniture-preview.png`: Ein eingerichteter Raum mit fünf Arbeitsplätzen und Kaffeeecke sowie eine Übersicht aller neuen Bausteine; alle Spielgrafiken exakt dreifach vergrößert, ohne Glättung.
- `checks/furniture-animation.gif`: Dampf, Espressomaschine, Blase und Lampenwechsel. Die Vorschau läuft für die gemeinsame Betrachtung in Schritten von 160 ms; die einzelnen Laufzeitintervalle stehen im Atlas.
- `checks/furniture-quality.json`: Prüfung von Maßen, Palette, Alpha, Atlasgrenzen, Überlappungen, Auflagepunkten und festen Animationskörpern. Die Dampfwolke und die Wasserblase müssen messbar aufsteigen.
- Die bisherigen Boden- und Architekturvorschauen sowie ihre Prüfberichte bleiben enthalten.

Die exportierten GIF-Bilder werden gegen die entsprechenden Atlasbilder geprüft. Beschriftungen gehören ausschließlich zu den vom Code erzeugten Prüfansichten. In den Spielgrafiken steht kein Text.

## Wiederholbar bauen

```sh
python3 -m pip install -r tools/requirements.txt
python3 tools/prepare_furniture.py
```

Der Gesamtbefehl baut die Böden, Architektur und Möblierung in dieser Reihenfolge und schreibt am Ende den vollständigen Atlas. Er benötigt keinen API-Zugriff. Die älteren Skripte sind darin verwendete Zwischenstufen und erzeugen einzeln nur ihren jeweiligen Stand.

Die originalen Rohbilder liegen unter `art/raw/`. `art/furniture-source.json` hält deren Abmessungen, Prüfsummen und Zuschnitte fest. Die exakten Bildprompts stehen in `art/prompts/workplace.txt` und `art/prompts/kitchen.txt`; erzeugt wurden sie mit der integrierten Bildgenerierung und dem freigegebenen Stil-Anker als Referenz. Die technische Bereinigung reduziert Farben ohne Dithering, schließt Konturen und vereinheitlicht die Körper und Fußlinien der Animationen. Größere Ausgangsdetails werden im Zielraster vereinfacht.

Weitere Informationen zu Böden und Wänden stehen in `docs/floors.md` und `docs/architecture.md`.

Als Nächstes folgen die beiden Grundfiguren und danach ihre Geh- und Arbeitsanimationen.
