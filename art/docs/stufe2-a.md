# Pixel-Büro · Stufe 2 · Paket A

**Paket A ist abgeschlossen.** Das kumulative Paket enthält alle Assets aus
Stufe 1 und die erste Wanddekoration für Stufe 2: **169 Sprites und 25 Animationen**.
Die neue Datei ist `public/assets/office/decor/wall.png` mit **128 × 96 px**.

## Neue Sprites

Alle haben `placement: "wall"`, `frames: 1` und `anchor: [0, height]`.

| Name | Größe | wallY | Zusatzdaten |
| --- | --- | --- | --- |
| window-day | 32 × 24 | 3 | Tag |
| window-dawn | 32 × 24 | 3 | Morgen |
| window-dusk | 32 × 24 | 3 | Abend |
| window-night | 32 × 24 | 3 | Nacht |
| whiteboard | 48 × 24 | 3 | contentRect [3, 3, 42, 16] |
| corkboard | 32 × 24 | 4 | fünf leere, angepinnte Zettel |
| wall-tv | 32 × 24 | 3 | contentRect [3, 3, 26, 17] |
| wall-clock | 16 × 16 | 4 | handsCenter [8, 8] |
| calendar | 16 × 16 | 6 | contentRect [3, 6, 10, 8] |
| picture-landscape | 16 × 16 | 6 | Landschaft |
| picture-abstract | 16 × 16 | 6 | Kreis und Rechteck |
| poster-mountain | 16 × 24 | 4 | Schneeberg |
| wall-shelf | 32 × 16 | 6 | vier Bücher und kleine Pflanze |

## Montage

Der Atlas bleibt bei `meta.schemaVersion: 2`. Neue Ausschnitte stehen unter
`sprites`, das neue Blatt unter `meta.images`. Alle bestehenden Werte wurden
erhalten. `stateGroups.window` fasst die vier Fensterzustände zusammen; sie
werden nach Tageszeit gewählt und sind keine zyklische Animation.

`wallY` beschreibt die **Oberkante** relativ zur Oberkante einer 32 px hohen
Wand. Bei einem Renderer mit Ausschnitt-Koordinaten wird bei
`wallTop + wallY` gezeichnet. Verwendet der Renderer stattdessen den unteren
Anker, liegt dessen y-Position bei `wallTop + wallY + height`.

Die vier Fenster teilen pixelgenau Rahmen, Mittelsteg, Sims, Silhouette und
Skyline. Himmel, Wolkenfarbe, Vegetationsfarbe und Fensterbeleuchtung wechseln.
Das Nachtfenster enthält einen Mond und drei einzelne Sternpixel. Whiteboard
und Kalender bleiben leer, die Uhr enthält nur vier Markierungen ohne Zeiger.
Der Fernseher hat eine leere dunkle Bildfläche mit einem Reflexstreifen.
Texte, Zahlen, Anzeigen und Uhrzeiger gehören in den Code.

## Prüfbilder und Bericht

- `art/checks/stufe2-a-sprites.png`: alle 13 neuen Sprites **exakt 3×** auf
  neutralem Grund, mit Namen, Maßen und Montagehöhe.
- `art/checks/stufe2-a-room.png`: alle Wandobjekte einschließlich eines
  Tagfensters in einer 3×-Raummontage mit bisherigen Figuren und Möbeln.
- `art/checks/stufe2-a-quality.json`: aktueller Prüfbericht.

Geprüft wurden ENDESGA 32, Alpha 0/255, Ausschnittgrößen, Atlasgrenzen,
überschneidungsfreie Belegung, Montagehöhen, Inhaltsrechtecke, Uhrmittelpunkt,
identische Fensterrahmen und Skyline sowie die tatsächlichen Vorschaupixel.
Alle **21 bisherigen Grafikdateien sind bytegleich**, und alle bisherigen
Atlaseinträge einschließlich Figuren und Animationen sind unverändert.

Die neuen Bilder sind Prüfmotive für den späteren Einbau in den Prototyp.
Das ZIP enthält die Assets, Rohquellen, Prompts und die vollständige
Nachbearbeitung; die Raummontage ist ein aus dem Atlas zusammengesetztes PNG.

## Reproduzieren

Python 3, Pillow und NumPy gemäß `tools/requirements.txt`:

```bash
python3 -m pip install -r tools/requirements.txt
python3 tools/prepare_stufe2_a.py
```

Das Skript baut zuerst Stufe 1 und ergänzt dann Paket A samt Prüfbildern und
Bericht. Ältere `prepare_*.py`-Skripte allein schreiben jeweils den damaligen
Atlasstand. Für diesen Gesamtstand deshalb **prepare_stufe2_a.py** verwenden.

## Quellen und Korrekturen

Ein Rohbild wurde mit der integrierten Bildgenerierung erzeugt und unverändert
als `art/raw/stufe2-a-wall.png` erhalten. Der vollständige englische Prompt liegt
in `art/prompts/stufe2-a-wall.txt`. Als Referenzen dienten der freigegebene
Stil-Anker und eine 8×-Ansicht der bestehenden Wände.

`art/stufe2-a-source.json` enthält Prüfsumme, Rohbildmaß, Ausschnitte und
Normalisierungshinweise. Das Rohbild hat 1254 × 1254 px; das Produktionsblatt hat
die oben angegebenen Originalpixelmaße. Die Python-Nachbearbeitung reduziert
auf das Raster und die feste Palette, vereinheitlicht die Fenstergeometrie,
glättet Farbbänder in diskrete Flächen, hält Schreibflächen frei und richtet die
vier Buchrücken und fünf Zettel lesbar aus. Es gibt keine Glättung oder
halbtransparenten Spritekanten.

`art/references/stufe1-atlas.json` und `art/stufe1-assets.json` dokumentieren den
unveränderten Ausgangsstand. Der aktuelle Fortschritt steht in
`art/stufe2-progress.json`; der vollständige Auftrag in
`docs/auftrag-stufe-2.md`.

## Nächste Pakete

Vorgesehene Reihenfolge: **B1 → C → B2 → D → F → G → E**.
B1 ergänzt Pflanzen und Regale. Frühere Hinweise und Berichte aus Stufe 1 sind
in `docs/` und `checks/` enthalten.
