# Pixel-Büro · Stufe 2 · A + B1 + C + B2 + D + F + G

Kumulatives Grafikpaket mit **274 Sprites und 50 Animationen**.
Paket G ergänzt 21 Effektsprites und sieben Animationen für Papierflieger,
Konfetti, Funkeln, Staub und fliegende Papierblätter. Alle vorherigen Pakete
bleiben vollständig enthalten.

## Neue Grafik und Atlas

`public/assets/office/fx/effects.png` ist ein gepacktes Blatt mit
**96 × 48 nativen Pixeln**. Die einzelnen Atlas-Ausschnitte verwenden;
unbenutzte Bereiche bleiben transparent.

| Sprites | Native Größe | Bilder | Anker |
| --- | --- | ---: | --- |
| `plane-right-0`, `plane-right-1` | je 8 × 8 | 2 | [4,4] |
| `plane-up-0`, `plane-up-1` | je 8 × 8 | 2 | [4,4] |
| `plane-down-0`, `plane-down-1` | je 8 × 8 | 2 | [4,4] |
| `confetti-0` bis `confetti-5` | je 16 × 16 | 6 | [8,8] |
| `sparkle-0` bis `sparkle-2` | je 8 × 8 | 3 | [4,4] |
| `dust-0` bis `dust-2` | je 8 × 8 | 3 | [4,8] |
| `paper-0` bis `paper-2` | je 8 × 8 | 3 | [4,4] |

Alle neuen Sprites haben `frames: 1`, `kind: "effect"` und
`blocksMovement: false`. Sie werden frei über der Szene positioniert;
es gibt keine Bodengrundflächen oder Wandanschlüsse. Der Staubanker liegt
unten mittig für die Montage an Fußpunkten; die übrigen Anker liegen mittig.

Der Atlas bleibt bei `meta.schemaVersion: 2`. Ein Bild, 21 Sprites und sieben
Animationen ergänzen den Bestand. Alle **253 bisherigen Spriteeinträge**,
alle 43 bisherigen Animationen und die übrigen bisherigen Metadaten bleiben
unverändert. Alle **36 vorherigen PNG-Dateien sind bytegleich** erhalten.

## Animationen

| Name | Zustände | Dauer je Bild | Schleife |
| --- | --- | ---: | --- |
| `plane-right` | `plane-right-0/1` | 120 ms | ja |
| `plane-up` | `plane-up-0/1` | 120 ms | ja |
| `plane-down` | `plane-down-0/1` | 120 ms | ja |
| `confetti` | `confetti-0` bis `confetti-5` | 90 ms | **nein** |
| `sparkle` | `sparkle-0` bis `sparkle-2` | 120 ms | ja |
| `dust` | `dust-0` bis `dust-2` | 100 ms | **nein** |
| `paper` | `paper-0` bis `paper-2` | 150 ms | ja |

Für Flug nach links die Rechtsansicht horizontal spiegeln; es gibt dafür
kein zusätzliches Bild und keine zusätzliche Animation. Die Flugzeugkörper
und Spitzen bleiben innerhalb jeder Richtung pixelgleich. Nur die Flügelspitzen
ändern ihre Lage um einen Pixel. Der aufrufende Code bewegt den gesamten
Flieger auf dem gewünschten Flugweg.

Konfetti startet als kompakter Ausbruch und verteilt sich nach außen.
Es enthält rote, gelbe, cyanfarbene, grüne und pinke Einzelpixel. Die sechs
Bilder enthalten 12, 12, 10, 8, 5 und 3 Partikel; die verbleibenden Stücke
liegen im Verlauf weiter unten. Das Funkeln wächst und schrumpft um einen
festen Mittelpunkt. Staub wächst von einer kleinen zu einer größeren Wolke
und endet mit genau zwei deckenden hellgrauen Pixeln. Das Papier wechselt
zwischen Vorderseite, gedrehter Fläche und schmaler Kantenansicht.

Konfetti und Staub nach dem letzten Bild aus der Szene entfernen.
Die reine Bildanimation ersetzt keine Flugbahn oder sonstige Positionsbewegung.
Die nicht vorgegebenen Zeiten für Flieger und Papier sind hier mit 120 ms
beziehungsweise 150 ms festgelegt und stehen ausdrücklich im Atlas.

## Pixel und Konturen

Alle Effekte verwenden ENDESGA 32 und ausschließlich Alpha 0/255.
Flieger, Funkeln, die beiden größeren Staubwolken und die Papierblätter
haben geschlossene Konturen in `#181425`. Einzelne Konfettipixel und die
beiden letzten Staubpixel tragen keine zusätzliche Kontur: Ein solcher Rand
würde die native Ein-Pixel-Fläche vollständig verdecken. Diese sieben
Partikelbilder werden im Prüfbericht getrennt von den 14 konturierten Formen
gezählt. Es gibt keine weichen Übergänge, halbtransparenten Wolken oder
bereits eingerechneten Hintergründe.

Die drei Kleidungsschlüsselfarben können in Effekten vorkommen, etwa als
Cyan-Konfetti. Der Kleidungsfarbtausch bleibt auf Figurenbilder und ihre
Masken beschränkt; Effekte werden nicht mit umgefärbt.

## Prüfungen und Vorschauen

- `art/checks/stufe2-g-sprites.png`: alle 21 neuen Sprites **exakt 3×**
  auf neutralem Grund, mit Namen und Maßen.
- `art/checks/stufe2-g-animation.gif`: alle Zustände bei **3×**, mit echten
  Bilddauern, gespiegelter Linksansicht und ausgeblendeten kurzen Effekten.
  Nur in dieser Demonstration werden Konfetti und Staub alle 1200 ms neu ausgelöst.
- `art/checks/stufe2-g-room.png`: alle sieben Animationsarten und der
  gespiegelte Linksflug über der vorhandenen Büroszene; **3×**.
- `art/checks/stufe2-g-quality.json`: aktueller Prüfbericht.

Geprüft werden native Maße, Palette, binäre Transparenz, Atlasgrenzen und
Belegung, transparente Leerfelder, Anker, fehlende Bewegungskollisionen,
Konturen der größeren Formen, stabile Flugzeugkörper, Flügellagen,
Konfettifarben und Partikelverlauf, Funkelgrößen, die zwei letzten Staubpixel,
unterschiedliche Papieransichten, Animationszustände, Bilddauern sowie die
Pixel in PNG-, GIF- und Raumvorschau. Alle 21 Zustände erscheinen nachweislich
in der Animationsvorschau. Die früheren Prüfberichte bleiben erhalten.

## Erneut erstellen

Python 3, Pillow und NumPy gemäß `tools/requirements.txt`:

```bash
python3 -m pip install -r tools/requirements.txt
python3 tools/prepare_stufe2_g.py
```

Das Skript baut zunächst alle vorherigen Pakete und ergänzt G. Für den
aktuellen Gesamtstand **prepare_stufe2_g.py** verwenden. Ältere Skripte
schreiben jeweils nur ihren damaligen Atlasstand.

## Rohbild, Prompt und Nachbearbeitung

Das neue Rohbild wurde mit der integrierten Bildgenerierung erstellt und
liegt unverändert unter `art/raw/stufe2-g-effects.png` (1254 × 1254 px).
Der exakte Prompt steht in `art/prompts/stufe2-g-effects.txt`. Referenzen
waren der Stil-Anker und die vorhandenen kleinen Effekte in
`art/references/effects-8x.png`.

`art/stufe2-g-source.json` dokumentiert Prüfsummen, Ausschnitte, Zielmaße,
Anker, Bilddauern, Partikelpositionen und Korrekturen. Python reduziert die
Rohformen auf native Pixel und Palette, übernimmt einen festen Fliegerkörper
je Richtung, vereinfacht kleine Partikel und schärft Sterne und Papierlagen
für die kleine Zielauflösung nach. Der letzte Staubzustand bleibt exakt
zwei Pixel groß.

Der unveränderte Ausgangsstand liegt in `art/references/stufe2-f-atlas.json`
und `art/stufe2-f-assets.json`. Der Fortschritt steht in
`art/stufe2-progress.json`, der vollständige Auftrag in
`docs/auftrag-stufe-2.md`, ältere Anleitungen in `docs/`.
Das ZIP liefert Assets und Skripte für den späteren Einbau in den Prototyp.

## Nächstes Paket

Als Nächstes folgt **E: vier weitere Figuren, look-03 bis look-06**.
