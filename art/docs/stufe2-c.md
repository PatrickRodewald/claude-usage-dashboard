# Pixel-Büro · Stufe 2 · A + B1 + C

Kumulatives Grafikpaket mit **192 Sprites und 27 Animationen**.
Paket C ergänzt zehn Objekttypen in 14 Spritebildern. Stufe 1 sowie A und B1
bleiben vollständig enthalten.

## Neue Grafik

`public/assets/office/decor/lounge.png` ist ein gepacktes Blatt mit
**192 × 96 nativen Pixeln**. Zum Zeichnen die einzelnen Atlas-Ausschnitte
verwenden; unbenutzte Bereiche bleiben transparent.

| Sprites | Native Größe | Platzierung | Grundfläche |
| --- | --- | --- | --- |
| `sofa` | 48 × 32 | Boden | 3 × 1 |
| `armchair` | 16 × 24 | Boden | 1 × 1 |
| `coffee-table` | 32 × 16 | Boden | 2 × 1 |
| `kitchen-table` | 32 × 24 | Boden | 2 × 1 |
| `stool` | 16 × 16 | Boden | 1 × 1 |
| `counter-sink` | 48 × 24 | Boden, an der Wand | 3 × 1 |
| `microwave` | 16 × 16 | Theke | – |
| `fruit-bowl` | 16 × 8 | Theke | – |
| `vending-0`, `vending-1` | je 16 × 32 | Boden, an der Wand | 1 × 1 |
| `kicker-0` bis `kicker-3` | je 48 × 24 | Boden | 3 × 1 |

Sofa und Sessel verwenden denselben türkisblauen Stoff mit drei ENDESGA-Farben.
Die drei Sofaplätze sind leer. Auf dem Couchtisch liegt eine geschlossene
Zeitschrift mit kleinem Bild, ohne Text. Die Obstschale enthält Apfel, Orange
und Banane. Es gibt keine Texte, Zahlen, Logos oder Personen in den neuen Sprites.

Die Spülentheke übernimmt Außenform, Holzplatte und Schrankfronten des
vorhandenen `kitchen-counter` pixelgleich. Nur Spüle und Wasserhahn ändern sich.
Beide Theken haben `surfaceBottomY: 10` und können nebeneinander stehen.
Mikrowelle und Obstschale erhalten keine Bodenkollision.

## Animationen

| Name | Zustände | Dauer je Bild | Schleife |
| --- | --- | --- | --- |
| `vending-glow` | `vending-0`, `vending-1` | 600 ms | ja |
| `kicker-play` | `kicker-0` bis `kicker-3` | 150 ms | ja |

Beim Automaten ändern sich 57 Hintergrundpixel innerhalb der Glasfront.
Gehäuse, neun Flaschen, Ablagen und die leere Tastatur bleiben gleich.
Der zweite Zustand zeigt eine etwas hellere Beleuchtung ohne Lichtschein.

Der Kicker verwendet in allen vier Zuständen denselben Holzrahmen und dieselben
Beine. Drei Metallstangen mit roten und blauen Spielfiguren verschieben sich
um jeweils einen Pixel; der weiße Ball hat vier Positionen. Änderungen bleiben
auf die beweglichen Ebenen beschränkt. Die äußere Silhouette bleibt identisch.

## Atlas und Interaktionsplätze

`public/assets/office/atlas.json` bleibt bei `meta.schemaVersion: 2`.
Alle **178 bisherigen Spriteeinträge**, alle 25 bisherigen Animationen und die
übrigen Metadaten sind unverändert. Ein Bild, 14 Sprites und zwei Animationen
ergänzen den Atlas. Alle **23 vorherigen PNG-Dateien bleiben bytegleich**.

Alle C-Objekte haben `anchor: [0, height]`. Bodenobjekte blockieren Bewegung
über ihre Kachelgrundfläche. Spülentheke und Automaten tragen `againstWall: true`;
die übrigen Bodenobjekte sind frei aufstellbar. Thekenobjekte haben keine
Kollisions- oder Grundflächendaten.

Ein `spots`-Eintrag bezeichnet den Fußpunkt einer Figur relativ zur linken
unteren Spriteecke. Die Weltposition ist
`[spriteLeft + dx, spriteBottom + dy]`. Ein negatives `dy` liegt oberhalb der
unteren Spritekante. Die Figur wird mit ihrem mittigen Fußanker dort platziert.

| Objekt | Spot | dx | dy | facing |
| --- | --- | ---: | ---: | --- |
| Sofa | `left` | 8 | -2 | `front` |
| Sofa | `middle` | 24 | -2 | `front` |
| Sofa | `right` | 40 | -2 | `front` |
| Sessel | `seat` | 8 | -2 | `front` |
| Hocker | `seat` | 8 | 0 | `front` |
| Bistrotisch | `left` | -8 | 0 | `right` |
| Bistrotisch | `right` | 40 | 0 | `left` |
| Kicker, alle Zustände | `left` | -8 | 0 | `right` |
| Kicker, alle Zustände | `right` | 56 | 0 | `left` |

Für Sofa und Sessel zuerst das Möbel, dann die sitzende Figur zeichnen. Die
passenden Figurenposen folgen in Paket F. Die Raummontage verwendet die
vorhandenen stehenden Seitenansichten neben dem Kicker.

## Prüfbilder und Berichte

- `art/checks/stufe2-c-sprites.png`: alle 14 neuen Atlas-Ausschnitte exakt **3×**
  auf neutralem Grund, pro Reihe unten ausgerichtet.
- `art/checks/stufe2-c-room.png`: alle zehn neuen Objekttypen zusammen mit A, B1,
  vorhandenen Möbeln und Figuren; Raumansicht **3×**.
- `art/checks/stufe2-c-animation.gif`: beide neuen Animationen bei **3×**,
  in 150-ms-Schritten, gemeinsame Gesamtschleife 1200 ms.
- `art/checks/stufe2-c-quality.json`: aktueller Prüfbericht.
- Frühere Prüfbilder, Berichte und Dokumentation bleiben enthalten.

Geprüft werden Maße, ENDESGA 32, Alpha 0/255, geschlossene Navy-Konturen,
untere Ausrichtung, Atlasgrenzen ohne Überlappungen, transparente Leerfelder,
Grundflächen, Kollisionen, Wandanschlüsse, Interaktionsplätze, identische
Animationskörper und tatsächliche Vorschaupixel einschließlich GIF-Farben.

## Erneut erstellen

Python 3, Pillow und NumPy gemäß `tools/requirements.txt`:

```bash
python3 -m pip install -r tools/requirements.txt
python3 tools/prepare_stufe2_c.py
```

Das Skript baut zuerst Stufe 1, A und B1 neu und ergänzt C. Für den aktuellen
Gesamtstand immer **prepare_stufe2_c.py** verwenden. Ältere Skripte erzeugen
jeweils ihren damaligen Atlasstand.

## Rohbild, Prompt und Nachbearbeitung

Ein neues Rohbild wurde mit der integrierten Bildgenerierung erstellt. Es liegt
unverändert unter `art/raw/stufe2-c-lounge.png` (1254 × 1254 px). Der genaue
Prompt steht in `art/prompts/stufe2-c-lounge.txt`. Referenzen waren der
freigegebene Stil-Anker und `art/references/furniture-8x.png`.

`art/stufe2-c-source.json` dokumentiert Prüfsummen, Ausschnitte, Zielmaße,
Materialpaletten und Pixelkorrekturen. Python reduziert auf native Pixel,
Palette und binäre Transparenz. Die Stoffschattierung wird mit festen
Helligkeitsklassen erhalten, Konturen werden geschlossen, kleine Flaschen
und Früchte lesbar angeordnet und die Spüle auf die vorhandene Theke ausgerichtet.
Die Kickeroberfläche wird auf native Spielfeldlinien, Stangen, Figuren und
Ballpositionen bereinigt. Alle Zustände teilen eine gemeinsame Gehäusebasis.

`art/references/stufe2-b1-atlas.json` und `art/stufe2-b1-assets.json` dokumentieren
den Stand vor C. Der Fortschritt steht in `art/stufe2-progress.json`, der
vollständige Auftrag in `docs/auftrag-stufe-2.md` und ältere Anleitungen in `docs/`.
Die Raumdarstellung ist eine Prüfmontage aus dem Atlas. Das ZIP liefert Grafiken
und Skripte für den späteren Einbau in den Prototyp.

## Nächste Pakete

Reihenfolge: **B2 → D → F → G → E**.
Als Nächstes folgt **B2: Technik und Kleinkram**.
