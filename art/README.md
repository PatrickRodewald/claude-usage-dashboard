# Pixel-Büro · Stufe 2 · vollständig

> **Im Dashboard-Repository** liegt dieses Paket unter `art/`, die fertigen Grafiken samt
> `atlas.json` unter `public/assets/office/`. Prüfansichten und Berichte stehen in
> `art/checks/`, Anleitungen der einzelnen Pakete in `art/docs/`, der Auftrag für
> Stufe 2 in `art/auftrag-stufe-2.md`. Die Skripte in `art/tools/` rechnen ab der
> Wurzel des Repositorys und schreiben direkt nach `public/assets/office/`, z. B.
> `python3 art/tools/prepare_stufe2_e.py`.

Kumulatives Grafikpaket mit **390 Sprites, 82 Animationen und sechs Looks**.
Enthalten sind A, B1, C, B2, D, F, G und E in der vereinbarten Reihenfolge.
Paket E ergänzt vier Figuren mit Grundansichten, Geh- und Arbeitsanimationen:
**116 neue Sprites und 32 neue Animationen**. Alle bisherigen Inhalte bleiben erhalten.

## Die vier neuen Looks

| Look | Rolle | Merkmale |
| --- | --- | --- |
| `look-03` | `main-session` | Frau, mittelbraune Haut, langer dunkler Pferdeschwanz, Blazer über weißem Shirt |
| `look-04` | `main-session` | Mann, helle Haut, kurze rote Haare, Bart, eckige Brille, Strickweste über hellem Hemd |
| `look-05` | `subagent` | Person, dunkle Haut, kurze lila Haare, graue Kopfhörer um den Hals, T-Shirt |
| `look-06` | `subagent` | Frau, helle Haut, blonder Bob, rote Haarspange, T-Shirt |

Alle Figurenbilder sind **16 × 32 native Pixel**, Fußpunkt `[8,32]`,
`feetBaseline: 32`, Grundfläche `[1,1]`. Links wird aus rechts gespiegelt.
Der Atlas bleibt bei `meta.schemaVersion: 2`. Die Einträge unter `characters`
folgen dem bestehenden Aufbau und enthalten Ansichten, Animationsverweise,
Farbmasken und Spiegelverweise.

## Dateien und Animationen

Für jeden neuen Look liegen unter `public/assets/office/characters/look-0x/`
dieselben sieben Grund-, Geh- und Arbeitsdateien wie bei den bisherigen Figuren:

| Datei | Native Größe | Inhalt |
| --- | --- | --- |
| `sheet.png` | 48 × 32 | vorn, hinten, rechts |
| `recolor-mask.png` | 48 × 32 | Kleidungsmaske der Grundansichten |
| `walk.png` | 64 × 128 | vier Zeilen: vorn 4, hinten 4, rechts 4, atmen 2 Bilder |
| `walk-recolor-mask.png` | 64 × 128 | Kleidungsmaske des Gehblatts |
| `desk-work.png` | 48 × 128 | vier Zeilen: tippen, lesen, schreiben, denken; je 3 Bilder |
| `desk-work-recolor-mask.png` | 48 × 128 | Kleidungsmaske des Arbeitsblatts |
| `desk-work-hands.png` | 48 × 128 | Hände und unmittelbare Kontur als Vordergrund |

Die beiden letzten Zellen der vierten Gehzeile bleiben vollständig transparent.
Jedes Sprite im Atlas trägt `frames: 1`; die Bewegung steht unter `animations`.
Die folgenden Namen gelten für jeden Look, zum Beispiel `look-03-walk-front`
und die zugehörigen Zustände `look-03-walk-front-0` bis `-3`.

| Animationsname mit Look-Präfix | Bilder | Dauer je Bild | Schleife |
| --- | ---: | ---: | --- |
| `look-0x-walk-front` | 4 | 120 ms | ja |
| `look-0x-walk-back` | 4 | 120 ms | ja |
| `look-0x-walk-right` | 4 | 120 ms | ja |
| `look-0x-idle` | 2 | 700 ms | ja |
| `look-0x-type` | 3 | 160 ms | ja |
| `look-0x-read` | 3 | 220 ms | ja |
| `look-0x-write` | 3 | 160 ms | ja |
| `look-0x-think` | 3 | 500 ms | ja |

**Umfang von F:** Die zusätzlichen Ruhe- und Aktionsblätter aus Paket F sind
für `look-01` und `look-02` enthalten. Diese beiden Looks existierten, als F
in der vereinbarten Reihenfolge bearbeitet wurde. Die danach hinzugefügten
Looks 03–06 besitzen die drei in E beauftragten Blätter und die acht oben
aufgeführten Animationen; sie haben keine `rest.png` oder `action.png`.

## Farbaustausch und Zeichenreihenfolge

Ausschließlich Kleidungsflächen verwenden `#2ce8f5`, `#0099db` und `#124e89`.
Die Masken enthalten genau diese Pixel als deckendes Weiß, alles andere ist
transparent. Blazer und Ärmel von 03, die Weste von 04 sowie die T-Shirts von
05/06 bleiben umfärbbar. Bei der angehobenen Blazerhand von `look-03-think-2`
reichen Kleidungsfarben auch über die normale Torsohöhe hinaus. Haar, Haut,
Brille, Kopfhörer, rote Spange, helle Hemden, Hose, Schuhe und Stuhl werden
nicht mit umgefärbt. Beim Farbaustausch immer von einer unveränderten
Quellkopie und der zum Blatt gehörenden Maske ausgehen.

Arbeitsbilder enthalten bereits den Stuhl (`includesChair: true`).
Zeichenfolge: **Figur mit Stuhl → Tisch → Prop → Hand-Vordergrund**.
Das Prop wird relativ zum Figurenursprung bei `[0,12]` platziert:

- Tippen: vorhandenes `laptop-back-open`.
- Lesen: vorhandenes `book-page-turn`, Zuordnung `[0,1,3]`.
- Schreiben: vorhandenes `notepad-write`, Zuordnung `[0,1,2]`.
- Denken: kein zusätzliches Prop.

Die Hände werden aus `foregroundImage` mit demselben Ausschnitt wie das
Arbeitsbild gelesen. Ihre deckenden Pixel stimmen exakt mit der Figur
überein; sie enthalten ausschließlich Hautfarben und unmittelbar angrenzende
Kontur. Hals und Kragen gehören nicht in diese Ebene.

## Nachbearbeitung und Quellen

Zwölf neue Rohbilder wurden mit der integrierten Bildgenerierung erzeugt,
je Look genau ein Grundblatt, ein Gehblatt und ein Arbeitsblatt. Die Rohbilder
liegen unverändert unter `art/raw/stufe2-e-look-0x*.png`. Die exakten Prompts
stehen unter `art/prompts/look-0x*.txt`; sie folgen den vorhandenen drei
Promptvorlagen und ersetzen die Beschreibung der jeweiligen Person.

`art/stufe2-e-source.json` dokumentiert alle zwölf Prüfsummen und Bildgrößen,
die Ausschnitte, Torsohöhen, Zielblätter, Ausgabedatei-Prüfsummen und
Nachbearbeitung. Verwendet werden flächenbasierte Rasterung auf native Pixel,
ENDESGA 32, binäres Alpha 0/255 und geschlossene Konturen in `#181425`.

Beim Gehen bleiben die freigegebenen Grundköpfe pixelgleich; jeder Look
verwendet seine eigenen erzeugten Beinstellungen. Alle drei Richtungen
besitzen vier unterschiedliche Beinsilhouetten. Pferdeschwanz, Kopfhörer
und Bob werden über den Kopfstreifen hinaus erhalten. Die Atmung bewegt
die äußeren Schultern um einen Pixel. Die Arbeitsbilder übernehmen den
Körperkern der Grundfigur, drei unterschiedliche Quellgesten je Tätigkeit
und je Look eine feste untere Sitz- und Stuhlbasis. Die kleine eckige Brille
wurde für die native Auflösung mit 3 × 3 Pixeln je Fassung nachgezeichnet.

## Prüfungen und Vorschauen

- `art/checks/stufe2-e-sprites.png`: alle 116 neuen Sprites exakt **3×**
  auf neutralem Grund, sortiert nach Look und Tätigkeit.
- `art/checks/stufe2-e-looks.png`: alle zwölf Grundansichten in Original,
  Grün und Rot sowie die Kleidungsmaske, ebenfalls **3×**.
- `art/checks/stufe2-e-animation.gif`: alle 32 neuen Animationen mit echten
  Bilddauern, separaten Props und Händen bei **3×**. Der 4200-ms-Vorschauzyklus
  zeigt alle 104 Animationszustände.
- `art/checks/stufe2-e-room.png`: alle sechs Looks im Raum, neue Figuren
  beim Arbeiten und Gehen, **3×**.
- `art/checks/stufe2-e-quality.json`: aktueller Prüfbericht.

Geprüft werden Maße, Anker, Fußkontakt, Palette, Alpha, geschlossene Konturen,
Atlasgrenzen und transparente Leerfelder, alle drei Kleiderschlüsselfarben,
exakte Masken, Farbaustausch ohne Nebenwirkungen, feste Gehköpfe,
unterschiedliche Beinsilhouetten und Gesten, Atmung mit echter Formänderung,
stabile Stühle und Sitzfüße sowie Vordergrundpixel. Alle 48 neuen
Arbeitszustände werden mit Tisch und Prop auf freie Hände geprüft. Die
exportierten Vorschauen werden pixelgenau gegen die Atlasbilder geprüft;
auch die tatsächlichen GIF-Bilddauern werden aus der gespeicherten Datei gelesen.

Alle **274 bisherigen Spriteeinträge**, die **50 bisherigen Animationen**
und die übrigen bisherigen Atlasfelder sind unverändert. Alle **37 bisherigen
PNG-Dateien bleiben bytegleich**. Der eingefrorene Stand liegt in
`art/references/stufe2-g-atlas.json` und `art/stufe2-g-assets.json`.
Die älteren Prüfberichte und Anleitungen bleiben im Paket.

## Erneut erstellen

Python 3, Pillow und NumPy gemäß `tools/requirements.txt`:

```bash
python3 -m pip install -r tools/requirements.txt
python3 tools/prepare_stufe2_e.py
```

Das Skript baut alle vorherigen Stufen und ergänzt anschließend E samt
Validierung und Vorschauen. Für den vollständigen Gesamtstand
**prepare_stufe2_e.py** verwenden; ältere Skripte schreiben nur ihren damaligen
Atlasstand. Der Fortschritt steht in `art/stufe2-progress.json`, der Auftrag
in `docs/auftrag-stufe-2.md` und die ältere Anleitung für G in `docs/stufe2-g.md`.

Alle acht Pakete aus Stufe 2 sind erstellt. Das ZIP enthält die Assets und
Skripte für den nächsten Schritt: den Einbau in den vorhandenen Prototyp.
