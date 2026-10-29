# Pixel-Büro, Stufe 2: Einrichtung und mehr Leben – Auftrag für ChatGPT

Ziel: Das Büro wirkt bewohnt statt leer. Dafür braucht es Fenster und Bilder an den Wänden,
Pflanzen, Regale und Technik an den Rändern, eine Lounge mit Sofa und Kicker, eine richtige Küche,
mehr Böden und Wände, weitere Figuren und ein paar Animationen. Alles erweitert das bestehende
Paket aus Stufe 1; nichts davon ersetzt etwas.

## So gehst du vor

1. Neuer Chat mit ChatGPT. Als Anhänge:
   - `data/pixel-office-emotes-kit.zip` (das letzte Gesamtpaket aus Stufe 1: Stil, Atlas, Skripte)
   - `art/style-anchor.png`
2. Als erste Nachricht den Abschnitt **„Auftrag an ChatGPT“** unten einfügen.
3. Dann die Pakete **einzeln** anstoßen: „Bitte Paket A“ usw. Jedes Paket ist ein Bild (Paket E und F
   mehrere). Nach jedem Paket bereinigt ChatGPT, prüft und baut das Gesamt-ZIP neu.
4. Reihenfolge nach Wirkung: **A, B1, C, B2, D**, dann **F**, **G**, zuletzt **E**. Schon nach A, B1
   und C kann ich das Büro einrichten; leg mir dann das ZIP wieder unter `data/`.

## Auftrag an ChatGPT

> Du erweiterst das angehängte Pixel-Office-Paket (Stufe 1) um Stufe 2. Halte dich genau an
> die Konventionen des Pakets: 16-px-Raster, Figuren 16 × 32, ausschließlich ENDESGA 32,
> Alpha nur 0 oder 255, Kontur #181425, Licht von oben links, Draufsicht im 3/4-Winkel wie
> im Stil-Anker. Arbeite wie in Stufe 1: ein Rohbild je Prompt mit der integrierten
> Bildgenerierung, Rohbild unverändert unter `art/raw/`, Prompt unter `art/prompts/`, dann
> Bereinigung per Python (Rasterung auf Originalpixel, Palette, binäre Transparenz,
> Konturen schließen), Ausschnitte und Prüfsummen in einer `art/*-source.json`.
>
> **Atlas:** `public/assets/office/atlas.json` bleibt `schemaVersion: 2`. Alle bestehenden
> Einträge bleiben unverändert. Neue Bilder unter `meta.images`, neue Sprites und Animationen mit
> **genau den Namen aus den Listen** (der Code arbeitet mit diesen Namen). Pro Sprite wie bisher
> `image, x, y, width, height, frames, anchor`, zusätzlich:
>
> - `placement`: `"floor"` (steht auf dem Boden), `"wall"` (hängt an einer Wand von vorn),
>   `"desk"` (steht auf einem Tisch), `"counter"` (steht auf der Küchentheke)
> - Boden: `footprintTiles [w, h]`, `blocksMovement` (true, außer Matten und Teppiche),
>   `againstWall: true` für alles, was mit dem Rücken an der Wand steht
> - Wand: `wallY` = Abstand in Pixeln von der Oberkante der 32 px hohen Wandkachel bis zur
>   Oberkante des Sprites
> - wo Code etwas hineinzeichnet: `contentRect [x, y, w, h]` (Whiteboard, Fernseher, Kalender)
>   bzw. `handsCenter [x, y]` (Wanduhr)
> - wo Figuren stehen oder sitzen: `spots` als Liste `{ "name", "dx", "dy", "facing" }`, Fußpunkt
>   relativ zur linken unteren Ecke des Sprites in Pixeln (Sofa, Kicker, Küchentisch)
>
> Animationen wie bisher unter `animations` (`states`, `frameDurationMs`, `loop`).
> Figurenblätter neuer Looks folgen exakt dem Aufbau von `look-01`/`look-02` (gleiche
> Dateien, Zeilen, Masken, Hände, Schlüsselfarben #2ce8f5/#0099db/#124e89 nur auf der Kleidung).
>
> Liefere nach jedem Paket: Prüfbild in `art/checks/` (alle neuen Sprites exakt 3-fach auf
> neutralem Grund, dazu eine Montage im Raum), Prüfbericht als JSON, und das **kumulative
> ZIP** `pixel-office-stufe2-kit.zip` mit derselben Ordnerstruktur wie bisher. Keine Texte,
> Zahlen, Logos oder Markennamen in den Grafiken.

## Stil-Baustein

Gehört an den Anfang jedes Bild-Prompts (ChatGPT kennt ihn aus Stufe 1, trotzdem mitschicken):

```text
STYLE (apply to everything):
Pixel art game asset for a cozy modern office simulation, top-down 3/4 view (floors seen from above, front faces of walls, furniture and people visible).
Strict pixel grid: 1 floor tile = 16x16 art pixels, 1 character = 16x32 art pixels.
Draw at a clean integer magnification, 8x unless stated otherwise: every art pixel is a perfect, solid square block, all blocks the same size, aligned to one shared grid.
No anti-aliasing, no blur, no gradients, no noise, no soft shadows. Flat shading with at most 3 tones per material.
1-pixel outline in deep navy #181425, never pure black. Light comes from the top left; small hard drop shadow (1 art pixel) to the bottom right.
Use only the ENDESGA 32 palette.
Transparent background. No text, no letters, no numbers, no logos, no watermark, no frame, no UI, no signature.
When several items are requested: arrange them in a neat grid with plenty of empty space between them, each item complete and not overlapping, all at the same scale.
Input image: approved STYLE REFERENCE ONLY (attached style anchor and existing sprites). Match its warm wood, beige walls, dark navy outlines and simple shapes.
```

Danach folgt jeweils der Paket-Prompt. Jede Tabelle sagt, unter welchem Namen und mit welchen
Maßen ein Teil in den Atlas kommt.

---

## Paket A – Wand: Fenster, Tafeln, Bilder, Uhr

Datei: `public/assets/office/decor/wall.png`. Alles `placement: "wall"`.

| Name | Größe | wallY | Hinweis |
| --- | --- | --- | --- |
| `window-day` | 32 × 24 | 3 | Himmel blau, zwei Wolken, ferne Stadt |
| `window-dawn` | 32 × 24 | 3 | gleiches Fenster, Morgenrot |
| `window-dusk` | 32 × 24 | 3 | gleiches Fenster, Abendrot, erste Lichter |
| `window-night` | 32 × 24 | 3 | gleiches Fenster, Nacht, Mond, erleuchtete Fenster |
| `whiteboard` | 48 × 24 | 3 | leer; `contentRect` = weiße Fläche |
| `corkboard` | 32 × 24 | 4 | Kork mit bunten Zetteln |
| `wall-tv` | 32 × 24 | 3 | schwarzer Bildschirm; `contentRect` = Bildfläche |
| `wall-clock` | 16 × 16 | 4 | ohne Zeiger; `handsCenter` |
| `calendar` | 16 × 16 | 6 | Abreißkalender, Blatt leer; `contentRect` |
| `picture-landscape` | 16 × 16 | 6 | gerahmtes Bild |
| `picture-abstract` | 16 × 16 | 6 | gerahmtes Bild |
| `poster-mountain` | 16 × 24 | 4 | Poster |
| `wall-shelf` | 32 × 16 | 6 | Brett mit Büchern und kleiner Pflanze |

```text
[STYLE-BAUSTEIN]

Wall decoration sprite sheet. Objects hang on a beige office wall, seen straight from the front. Do not draw the wall itself. Output: one square transparent PNG, target 1024x1024. Exactly FOUR separated rows, each art pixel a solid 8x8 block.

ROW 1, FOUR WINDOWS, each 32 wide x 24 tall, IDENTICAL light wooden frame, crossbar and window sill in all four, only the view changes:
1. day: light blue sky, two simple white clouds, a distant flat city skyline in blue-grey at the bottom
2. dawn: sky in bands of pink and orange, same skyline darker
3. dusk: sky in purple and orange bands, skyline dark with a few small yellow lit windows
4. night: deep navy sky, a small moon, three single-pixel stars, skyline almost black with several yellow lit windows

ROW 2:
1. whiteboard 48x24: aluminium frame, completely empty white surface, small marker tray at the bottom with two markers (one red, one blue)
2. cork pinboard 32x24: wooden frame, cork surface with five small square paper notes in yellow, pink, green and light blue, each with a pin; notes are blank
3. flat wall-mounted TV 32x24: thin dark frame, screen completely black with one diagonal grey reflection line

ROW 3, each 16x16 unless stated:
1. round wall clock: white face, dark rim, four tick marks, NO hands
2. tear-off wall calendar: red top band with two rings, blank white page
3. small framed picture: green hills under a blue sky
4. small framed picture: abstract orange circle and teal rectangle
5. poster 16x24: simple mountain with snow cap, pinned at the top corners

ROW 4:
1. wall shelf 32x16: wooden plank with four colourful book spines standing and a tiny plant in a white pot on the right

Everything flat, front facing, no perspective tilt. No text, no numbers on the calendar or clock.
```

## Paket B1 – Pflanzen und Regale

Datei: `public/assets/office/decor/decor-a.png`. Alles `placement: "floor"`, `blocksMovement: true`.

| Name | Größe | Footprint | an der Wand |
| --- | --- | --- | --- |
| `plant-tall` | 16 × 32 | 1 × 1 | nein |
| `plant-bush` | 16 × 24 | 1 × 1 | nein |
| `plant-palm` | 16 × 32 | 1 × 1 | nein |
| `plant-desk` | 8 × 12 | – | `placement: "desk"` |
| `cactus-desk` | 8 × 12 | – | `placement: "desk"` |
| `bookshelf` | 32 × 32 | 2 × 1 | ja |
| `bookshelf-low` | 32 × 24 | 2 × 1 | ja |
| `filing-cabinet` | 16 × 32 | 1 × 1 | ja |
| `coat-rack` | 16 × 32 | 1 × 1 | nein |

```text
[STYLE-BAUSTEIN]

Office plants and storage furniture sprite sheet, top-down 3/4 view like the attached desks and kitchen. Output: one square transparent PNG, target 1024x1024. Exactly THREE separated rows, each art pixel a solid 8x8 block. All objects bottom-aligned per row, same scale as a 16x32 character.

ROW 1, PLANTS:
1. tall monstera plant in a white cylindrical pot, 16 wide x 32 tall, big split leaves
2. round bushy plant in a terracotta pot, 16x24
3. small palm in a grey concrete pot, 16x32, thin fronds
4. tiny succulent in a white cup for a desk, 8x12
5. tiny cactus in a terracotta cup for a desk, 8x12

ROW 2, SHELVES:
1. tall wooden bookshelf 32 wide x 32 tall, seen from the front, three shelves full of colourful book spines, one shelf with a small box
2. low wooden bookshelf 32x24, two shelves of books, a small plant standing on top

ROW 3:
1. grey-blue metal filing cabinet 16x32 with three drawers and small handles (same style as the cabinet in the style anchor)
2. standing coat rack 16x32, dark wood, one dark blue jacket and a scarf hanging on it

Leaves in 3 greens of the palette, pots with a 1-pixel highlight on the top left. No text on book spines.
```

## Paket B2 – Technik und Kleinkram

Datei: `public/assets/office/decor/decor-b.png`. `placement: "floor"`.

| Name | Größe | Footprint | Hinweis |
| --- | --- | --- | --- |
| `printer-idle` | 16 × 24 | 1 × 1 | Drucker auf kleinem Schrank, an der Wand |
| `printer-1` … `printer-3` | 16 × 24 | 1 × 1 | Blatt kommt heraus; Animation `printer-print`, 200 ms, `loop: false` |
| `server-0` … `server-3` | 16 × 32 | 1 × 1 | Serverschrank, LEDs blinken; Animation `server-blink`, 180 ms, an der Wand |
| `trash-bin` | 16 × 16 | 1 × 1 | leer |
| `trash-bin-full` | 16 × 16 | 1 × 1 | mit zerknülltem Papier |
| `floor-lamp-off` | 16 × 32 | 1 × 1 | Stehlampe |
| `floor-lamp-on` | 16 × 32 | 1 × 1 | gleiche Lampe, Schirm leuchtet (kein Lichtkegel) |
| `beanbag` | 16 × 16 | 1 × 1 | Sitzsack |
| `doormat` | 16 × 16 | 1 × 1 | flache Fußmatte, `blocksMovement: false` |

```text
[STYLE-BAUSTEIN]

Office technology and small items sprite sheet, top-down 3/4 view. Output: one square transparent PNG, target 1024x1024. Exactly FOUR separated rows, each art pixel a solid 8x8 block, bottom-aligned.

ROW 1, FOUR PRINTER FRAMES, each 16x24: a light grey office printer standing on a small dark cabinet. Frame 1 idle. Frames 2 to 4: a white sheet of paper slides out of the front slot, a little further each frame. Printer and cabinet pixel-identical in all four frames.

ROW 2, FOUR SERVER RACK FRAMES, each 16x32: a dark navy server rack with five horizontal units. Small single-pixel status lights in green, cyan and yellow. The rack is pixel-identical in all frames; only which lights are on changes, like blinking.

ROW 3:
1. small grey trash bin 16x16, empty
2. the same bin 16x16 with crumpled white paper balls sticking out
3. floor lamp 16x32: thin dark pole, round base, fabric lampshade OFF (beige)
4. the same floor lamp ON: identical silhouette, lampshade bright warm yellow; no light cone or halo

ROW 4:
1. round beanbag chair 16x16 in orange
2. flat doormat 16x16, dark grey with a lighter border, seen from above
```

## Paket C – Lounge und Küche

Datei: `public/assets/office/decor/lounge.png`.

| Name | Größe | Footprint | Hinweis |
| --- | --- | --- | --- |
| `sofa` | 48 × 32 | 3 × 1 | von vorn, drei Sitze; `spots`: drei Sitzplätze, `facing: "front"` |
| `armchair` | 16 × 24 | 1 × 1 | gleicher Stoff; ein Sitzplatz |
| `coffee-table` | 32 × 16 | 2 × 1 | niedrig, Holz, eine Zeitschrift |
| `kitchen-table` | 32 × 24 | 2 × 1 | Bistrotisch; `spots`: zwei Stehplätze links und rechts |
| `stool` | 16 × 16 | 1 × 1 | Barhocker |
| `counter-sink` | 48 × 24 | 3 × 1 | wie `kitchen-counter`, aber mit Spüle; an der Wand |
| `microwave` | 16 × 16 | – | `placement: "counter"` |
| `fruit-bowl` | 16 × 8 | – | `placement: "counter"` oder `"desk"` |
| `vending-0`, `vending-1` | 16 × 32 | 1 × 1 | Getränkeautomat, Licht flackert leicht; Animation `vending-glow`, 600 ms, an der Wand |
| `kicker-0` … `kicker-3` | 48 × 24 | 3 × 1 | Kickertisch von oben; Ball und Stangen bewegen sich; Animation `kicker-play`, 150 ms; `spots`: links und rechts je ein Spieler |

```text
[STYLE-BAUSTEIN]

Lounge and kitchen furniture sprite sheet, top-down 3/4 view like the attached kitchen counter and desks. Output: one square transparent PNG, target 1024x1024. Exactly FOUR separated rows, each art pixel a solid 8x8 block, bottom-aligned.

ROW 1, LOUNGE:
1. three-seat sofa 48x32 seen from the front (people would sit facing the viewer): teal fabric, armrests, back cushions, short dark legs, empty
2. matching armchair 16x24, same teal fabric, front view, empty
3. low wooden coffee table 32x16 seen from above with one closed magazine on it (no text)

ROW 2, KITCHEN:
1. small wooden bistro table 32x24, empty top
2. bar stool 16x16 seen from above, round dark seat
3. kitchen counter 48x24 with a stainless steel sink and tap in the middle; same wood top, grey cabinets and height as the attached kitchen counter
4. microwave 16x16, white with a dark door window
5. fruit bowl 16x8 with an apple, an orange and a banana

ROW 3, TWO VENDING MACHINE FRAMES, each 16x32: dark red drinks vending machine, glass front showing rows of small colourful bottles, a small keypad. Frame 2 identical, the glass front lit slightly brighter.

ROW 4, FOUR FOOSBALL TABLE FRAMES, each 48x24, top-down: green playing field with white lines, wooden frame, three metal rods with tiny red and blue players on each side, a small white ball. The table is pixel-identical in all four frames; only the ball position and the rods shift by one or two pixels, as if a game is running. No people.
```

## Paket D – Böden und Wände

Datei: `public/assets/office/tiles/surfaces.png`.

| Name | Größe | Hinweis |
| --- | --- | --- |
| `carpet-blue`, `carpet-green`, `carpet-wine` | 16 × 16 | nahtlos kachelbar, feines Muster |
| `tile-lobby` | 16 × 16 | heller Steinboden, nahtlos |
| `runner-top-left` … `runner-bottom-right` | je 16 × 16 | Läufer für den Flur, neun Teile wie `rug-*`; im Atlas als `nineSlice.runner` |
| `wall-brick` | 16 × 32 | Wand von vorn, Backstein; links und rechts nahtlos |
| `wall-glass` | 16 × 32 | Glaswand mit Rahmen, hellblaues Glas mit Reflexen (binäre Transparenz) |
| `wall-wood` | 16 × 32 | Holzvertäfelung |
| `wall-green` | 16 × 32 | grün gestrichene Wand mit Lambris unten |

```text
[STYLE-BAUSTEIN]

Floor and wall surface tiles, each tile must repeat seamlessly with copies of itself on all four sides. Output: one square transparent PNG, target 1024x1024. Exactly THREE separated rows, each art pixel a solid 8x8 block.

ROW 1, FLOOR TILES, each 16x16, seen from above, seamless: 1. blue office carpet with a subtle fine dot pattern 2. green office carpet, same pattern 3. wine red office carpet, same pattern 4. light stone lobby floor with thin grout lines

ROW 2, A CARPET RUNNER as nine 16x16 parts in a 3x3 block (corners, edges, centre), dark red runner with a thin golden border; edges and centre must repeat seamlessly.

ROW 3, WALL SEGMENTS, each 16 wide x 32 tall, front view, seamless to the left and right, same top trim and baseboard height as the attached wall tiles:
1. red brick accent wall
2. glass partition: thin grey-blue frame, light cyan glass with two white diagonal reflection lines
3. warm wood panelling with vertical boards
4. sage green painted wall with a wooden wainscot on the lower third
```

## Paket E – Weitere Figuren (look-03 bis look-06)

Je Look drei Bilder, mit **denselben Prompts wie `look-01`/`look-02`** (in `art/prompts/` des
Pakets: Grundblatt, Gehen, Arbeiten am Tisch) – nur die Beschreibung der Person wird ersetzt.
Kleidung immer in den drei Schlüsselfarben, damit der Code sie umfärben kann. Haare, Haut und
Accessoires nie in diesen drei Farben.

| Look | Rolle | Beschreibung (statt der bisherigen) |
| --- | --- | --- |
| `look-03` | Hauptsitzung | Frau, mittelbraune Haut, langer dunkler Pferdeschwanz, Blazer über weißem Shirt |
| `look-04` | Hauptsitzung | Mann, helle Haut, rote kurze Haare, Bart, eckige Brille, Strickweste über Hemd |
| `look-05` | Subagent | Person, dunkle Haut, kurze lila Haare, Kopfhörer um den Hals, T-Shirt |
| `look-06` | Subagent | Frau, helle Haut, blonder Bob, Haarspange, T-Shirt |

Atlas: wie bei den vorhandenen Looks unter `characters`, Animationen `look-0x-walk-front` usw.

## Paket F – Neue Bewegungen (für alle Looks)

Für **jeden** Look (01, 02 und, falls schon da, 03–06) zwei zusätzliche Blätter, Figur exakt wie
im Grundblatt, 16 × 32 je Bild, Fußpunkt unten mittig:

| Datei | Zeilen (je Zeile Bilder) | Animationsnamen |
| --- | --- | --- |
| `characters/look-0x/rest.png` (48 × 64) | 1: am Tisch schlafen, Kopf auf den Armen (2 Bilder, Stuhl wie in `desk-work`) · 2: am Tisch aus der Tasse trinken (3 Bilder) | `look-0x-sleep` (700 ms), `look-0x-sip` (300 ms) |
| `characters/look-0x/action.png` (64 × 160) | 1: jubeln, Arme hoch (2) · 2: reden, Hand gestikuliert (2) · 3: stehend aus Tasse trinken, von vorn (2) · 4: am Kicker, Seitenansicht nach rechts, Hände an den Stangen (2) · 5: auf dem Sofa sitzen, von vorn, ohne Sofa (2, Atmen) | `look-0x-cheer` (300 ms), `look-0x-talk` (350 ms), `look-0x-drink` (600 ms), `look-0x-kicker` (150 ms), `look-0x-sofa` (900 ms) |

```text
[STYLE-BAUSTEIN]

Animation sheet for the attached approved character (use the attached character sheet as the exact reference: same head, hair, face, clothes, colours and proportions). Each frame 16 wide x 32 tall, feet on the bottom edge of the cell, drawn at 8x. Rows as listed, frames left to right, plenty of empty space between frames. Only the described body parts move; the head shape and clothes stay pixel-identical.

ROW 1: sitting on the attached dark office chair, front view, head resting on folded arms on an invisible desk edge, asleep. 2 frames: slow breathing (shoulders move by one pixel).
ROW 2: sitting on the same chair, front view, lifting a white mug to the mouth. 3 frames: mug at table height, halfway, at the mouth.
(For action.png instead:)
ROW 1: standing, front view, cheering with both arms raised. 2 frames.
ROW 2: standing, front view, talking: one hand gestures at chest height. 2 frames.
ROW 3: standing, front view, holding a white mug and sipping. 2 frames.
ROW 4: standing, side view facing right, both hands forward on foosball rods at hip height, leaning in. 2 frames.
ROW 5: sitting on an invisible sofa, front view, relaxed, hands on the knees. 2 frames: breathing.
Clothing only in the three key colours #2ce8f5 #0099db #124e89 exactly as in the reference.
```

Für `rest.png` bitte wie bei `desk-work` eine Hand-Vordergrundebene und Farbmasken mitliefern.

## Paket G – Effekte

Datei: `public/assets/office/fx/effects.png`.

| Name | Größe | Bilder | Animation |
| --- | --- | --- | --- |
| `plane-right-0/1`, `plane-up-0/1`, `plane-down-0/1` | 8 × 8 | je 2 | Papierflieger beim Delegieren; links = rechts gespiegelt |
| `confetti-0` … `confetti-5` | 16 × 16 | 6 | `confetti` 90 ms, `loop: false` |
| `sparkle-0` … `sparkle-2` | 8 × 8 | 3 | `sparkle` 120 ms |
| `dust-0` … `dust-2` | 8 × 8 | 3 | `dust` 100 ms, `loop: false` (Staubwölkchen beim Losgehen) |
| `paper-0` … `paper-2` | 8 × 8 | 3 | fliegendes Blatt Papier |

```text
[STYLE-BAUSTEIN]

Small effect sprites. Output: one square transparent PNG, target 1024x1024. Exactly FIVE separated rows, each art pixel a solid 8x8 block.

ROW 1: white paper airplane, 8x8 each: 2 frames flying to the right (wings flap by one pixel), 2 frames flying up (seen from below), 2 frames flying down.
ROW 2: confetti burst, 16x16 each, 6 frames: tiny squares in red, yellow, cyan, green and pink burst out from the centre and fall down, fewer pieces in the last frames.
ROW 3: sparkle, 8x8, 3 frames: a small white and yellow four-pointed star growing and shrinking.
ROW 4: dust puff, 8x8, 3 frames: a small light grey cloud appearing, growing, fading to two pixels.
ROW 5: a single white sheet of paper, 8x8, 3 frames: tumbling in the air.
```

---

## Wie ich die Teile einsetze

Damit klar ist, wofür jedes Teil gedacht ist (auch ChatGPT kann das mitlesen):

- **Fenster** an der Außenwand und in den Rückwänden, Himmel nach Tageszeit; nachts leuchten
  Stadt und Lampen.
- **Whiteboard** in jedem Projektraum: Der Code schreibt die Aufträge der Subagents darauf.
  **Fernseher** im Flur: Live-Kennzahlen (5h-Fenster als Balken). **Uhr** mit echten Zeigern,
  **Kalender** mit den Tagen bis zum Wochen-Reset.
- **Pflanzen, Regale, Aktenschränke, Garderobe, Mülleimer** füllen Ecken und Wände
  automatisch, je nach Raumgröße. Volle Mülleimer bei viel Verbrauch.
- **Drucker** druckt beim Commit, **Server** blinkt schneller, je mehr gerade läuft.
- **Lounge** im Flur bzw. in einem eigenen Raum: Sofa, Sessel, Kicker. Wer auf dich wartet,
  setzt sich aufs Sofa oder spielt eine Runde Kicker mit jemandem aus einem anderen Projekt.
- **Küche** mit Spüle, Mikrowelle, Tisch und Hockern; Snacks am Automaten.
- **Böden und Wände** geben jedem Projekt einen eigenen Charakter (Teppichfarbe, Wand).
- **Neue Figuren** und **Bewegungen**: mehr Vielfalt, schlafen am Tisch, Kaffee am Platz,
  jubeln nach dem Push, reden beim Besuch.
- **Effekte**: Papierflieger fliegt beim Delegieren zum Subagent, Konfetti beim Push.
