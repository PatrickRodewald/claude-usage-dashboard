# Pixel-Büro · Stufe 2 · A + B1 + C + B2 + D + F

Kumulatives Grafikpaket mit **253 Sprites und 43 Animationen**.
Paket F ergänzt sieben Bewegungen für jeden der beiden vorhandenen Looks:
insgesamt 30 Figurenbilder und 14 Animationen. Alle vorherigen Pakete bleiben
vollständig enthalten. Weitere Looks sind noch nicht Teil dieses Pakets.

## Neue Dateien je Look

| Datei unter `public/assets/office/characters/look-0x/` | Native Größe | Inhalt |
| --- | --- | --- |
| `rest.png` | 48 × 64 | Schlafen, 2 Bilder; Tasse am Tisch, 3 Bilder |
| `rest-recolor-mask.png` | 48 × 64 | weiße Maske exakt auf den Kleidungsschlüsselfarben |
| `rest-hands.png` | 48 × 64 | Vordergrund aus Armen/Händen, Kontur und Tasse |
| `action.png` | 64 × 160 | fünf Reihen mit jeweils 2 Bildern |
| `action-recolor-mask.png` | 64 × 160 | Kleidung der Aktionsposen |

Alle Bilder sind PNG mit ENDESGA 32 und Alpha ausschließlich 0/255.
Jedes Figurenbild ist 16 × 32 Pixel groß und hat `anchor: [8,32]`,
`feetBaseline: 32` und `footprintTiles: [1,1]`. Die Ruheposen enthalten bereits
den freigegebenen dunklen Bürostuhl (`includesChair: true`). Die Aktionsposen
enthalten keinen Stuhl, Tisch, Kicker oder Sofa (`includesChair: false`).
Die Tassen sind bereits in den zugehörigen Figurenbildern enthalten.

In `rest.png` bleibt die dritte Zelle der ersten Reihe transparent.
In `action.png` bleiben die letzten beiden Zellen jeder Reihe transparent.
Die Masken und die Vordergrundebene haben dieselben Zellpositionen.

## Animationen

Die folgenden Namen sind jeweils mit `look-01-` beziehungsweise `look-02-`
präfixiert. Alle Animationen laufen als Schleife und nutzen die vorhandenen
Atlasfelder `image`, `x`, `y`, `width`, `height`, `frames`, `states`,
`frameDurationMs`, `loop`, `anchor` und `recolorMask`.

| Name | Blatt / Reihe ab 0 | Bilder | Dauer je Bild |
| --- | --- | ---: | ---: |
| `sleep` | rest / 0 | 2 | 700 ms |
| `sip` | rest / 1 | 3 | 300 ms |
| `cheer` | action / 0 | 2 | 300 ms |
| `talk` | action / 1 | 2 | 350 ms |
| `drink` | action / 2 | 2 | 600 ms |
| `kicker` | action / 3 | 2 | 150 ms |
| `sofa` | action / 4 | 2 | 900 ms |

Einzelbilder heißen wie bisher beispielsweise `look-01-sip-0` bis
`look-01-sip-2`. Alle Verweise stehen zusätzlich unter
`characters[look].animations`. `animationMasks.rest` und
`animationMasks.action` verweisen auf die neuen Masken. Die nach rechts
blickende Kickerpose wird für die linke Blickrichtung gespiegelt;
`mirrorKickerLeftFrom` nennt die zugehörige Animation.

## Identität, Bewegung und Farbtausch

Die Posen stammen aus vier neuen generierten Rohbildern. Kopf- und Haarformen
werden auf die freigegebenen Front- beziehungsweise Rechtsansichten
zurückgeführt. Beim Schlafen sitzt derselbe Kopf vier Pixel tiefer auf den
verschränkten Armen; kleine geschlossene Augenstriche sind die einzige
Gesichtsänderung. Bei den Tassenposen darf die Tasse den Kinnbereich überdecken.

Schlafen und Sitzen auf dem Sofa bewegen nur die Schulterbereiche um einen
Pixel. Köpfe und Unterkörper bleiben dabei fest. Beim Jubeln bewegen sich
die erhobenen Arme, beim Reden gestikuliert eine Hand. Die Tasse bewegt sich
am Tisch durch drei Höhen und im Stehen zwischen Brust und Mund. Am Kicker
reichen die Arme nach rechts; die Reichweite passt zu den vorhandenen Spots.

Die Kleidung verwendet nur `#2ce8f5`, `#0099db` und `#124e89`. Alle drei
Farbtöne bleiben in jedem neuen Bild erhalten. Beim Jubeln dürfen die
angehobenen Ärmel auch oberhalb der üblichen Torsozeilen liegen. Die Masken
folgen deshalb den tatsächlichen Kleidungspixeln. Haare, Haut, Brille, Bart,
Hose, Schuhe, Stuhl und Tasse bleiben vom Farbtausch unberührt.

## Montage an Tisch, Sofa und Kicker

Für `sleep` und `sip` ist die Zeichenfolge:

1. Figur mit enthaltenem Stuhl aus `rest.png` zeichnen.
2. Den Tisch davor zeichnen.
3. Dieselbe Zelle aus dem in `foregroundImage` genannten `rest-hands.png`
   darüberlegen, auch wenn die Animation kein separates `prop` besitzt.

Die Vordergrundebene enthält bei `sip` auch die Tasse. So bleiben Hände und
Tasse auf dem Tisch oder am Mund sichtbar. Sie enthält keine Kleidungsschlüssel
und kann beim Farbtausch unverändert bleiben. Kein zweiter Stuhl und keine
zusätzliche Tasse werden benötigt.

Auf dem Sofa zuerst das Sofa und danach die sitzende Figur zeichnen. Die
Fußpositionen stehen bereits in `sofa.spots`. Am Kicker stehen die Figuren
an den linken und rechten Spots der `kicker-*`-Sprites; die rechte Figur
verwendet die gespiegelte Seitenansicht. Die vorhandenen Möbel- und Spotdaten
wurden nicht geändert.

## Prüfungen und Vorschauen

- `art/checks/stufe2-f-sprites.png`: alle 30 neuen Bilder **exakt 3×** auf
  neutralem Grund, nach Bewegung und Look geordnet.
- `art/checks/stufe2-f-layers.png`: beide Rest-Blätter mit Kleidungsmaske
  und Vordergrund, alle Ebenen **3×**.
- `art/checks/stufe2-f-animation.gif`: alle 14 Animationen mit echten
  Bilddauern, **3×**; Look 02 zeigt den Kleidungsfarbtausch nach Grün.
- `art/checks/stufe2-f-room.png`: alle sieben Bewegungen beider Looks in
  einer eingerichteten Posenmontage; jede Figur erscheint mehrfach.
- `art/checks/stufe2-f-quality.json`: aktueller Prüfbericht.

Geprüft werden native Blatt- und Zellmaße, Palette, binäre Transparenz,
Konturen, Anker und Fußlinie, unveränderte Kopfidentitäten, unterscheidbare
Bewegungsbilder, Kleidungsfarben und Masken, Farbtausch ohne Fremdänderungen,
transparente Leerzellen, passende Vordergrundpixel, drei Tassenhöhen,
Stuhlreste in Aktionsposen, Kickerreichweite sowie GIF-Pixel und Bilddauern.
Alle zehn Rest-Zustände beider Looks werden am tatsächlich davorliegenden
Tisch montiert und auf sichtbare Vordergrundpixel geprüft.

Der Atlas bleibt bei `meta.schemaVersion: 2`. Vier primäre Bilder und sechs
Hilfsbilder kommen hinzu. Alle **223 bisherigen Spriteeinträge**, alle
29 bisherigen Animationen und die übrigen bisherigen Metadaten bleiben
unverändert. Alle **26 vorherigen PNG-Dateien sind bytegleich** erhalten.

## Erneut erstellen

Python 3, Pillow und NumPy gemäß `tools/requirements.txt`:

```bash
python3 -m pip install -r tools/requirements.txt
python3 tools/prepare_stufe2_f.py
```

Das Skript baut zunächst alle vorherigen Pakete und ergänzt F. Für den
aktuellen Gesamtstand **prepare_stufe2_f.py** verwenden. Ältere Skripte
schreiben jeweils ihren damaligen Atlasstand.

## Rohbilder, Prompts und Nachbearbeitung

Die vier unveränderten Rohbilder heißen
`art/raw/stufe2-f-look-01-rest.png`, `art/raw/stufe2-f-look-01-action.png`,
`art/raw/stufe2-f-look-02-rest.png` und `art/raw/stufe2-f-look-02-action.png`.
Die exakten Prompts stehen mit denselben Namen als `.txt` in `art/prompts/`.
Referenzen sind die beiden freigegebenen Figurenmontagen
`art/references/look-01-f-reference-8x.png` und
`art/references/look-02-f-reference-8x.png` sowie der Stil-Anker.

`art/stufe2-f-source.json` enthält alle Prüfsummen, Ausschnitte, Körperabschnitte,
Zielmaße und Korrekturen. Python reduziert auf native Pixel, übernimmt die
freigegebenen Köpfe und Stühle, richtet Unterkörper und Fußpunkte aus und
bereinigt Gesten und Kontaktpunkte. Alte entspannte Hände werden beim
Übernehmen der Beine entfernt. Tasse und greifende Unterarme werden für die
kleine Zielauflösung geschlossen nachgearbeitet. Die Kleidungsmasken werden
exakt aus den drei Farbschlüsseln abgeleitet.

Der unveränderte Ausgangsstand liegt in `art/references/stufe2-d-atlas.json`
und `art/stufe2-d-assets.json`. Der Fortschritt steht in
`art/stufe2-progress.json`, der vollständige Auftrag in
`docs/auftrag-stufe-2.md`, ältere Anleitungen in `docs/`.
Das ZIP liefert Assets und Skripte für den späteren Einbau in den Prototyp.

## Nächste Pakete

Reihenfolge: **G → E**.
Als Nächstes folgt **G: Effekte**.
