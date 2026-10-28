# Pixel-Büro: Grafikpaket für Stufe 1

> **Im Dashboard-Repository** liegt dieses Paket unter `art/`, die fertigen Grafiken samt
> `atlas.json` unter `public/assets/office/`. Prüfansichten und Berichte stehen in
> `art/checks/`, ältere Hinweise in `art/docs/`. Die Skripte in `art/tools/` rechnen ab der
> Wurzel des Repositorys und schreiben direkt nach `public/assets/office/`, z. B.
> `python3 art/tools/prepare_emotes.py`.

Das kumulative Paket enthält **156 Sprites und 25 Animationen**: Böden, Teppich,
Wände, Türen, Arbeitsplätze, Kaffeeecke, zwei Grundfiguren mit Geh- und
Arbeitsanimationen sowie Sprechblasen und Emotes. Alle älteren Grafiken sind
unverändert enthalten. Der Canvas-Prototyp folgt als nächster Arbeitsschritt.

## Neue Assets

- Sprechblase und gewellte Denkblase: jeweils neun Teile zu **4 × 4 px**.
- Separater Sprechblasenschwanz: **4 × 4 px**, weißer Anschluss überlappt den
  unteren Blasenrand um eine Pixelzeile.
- Zwei Gedankenpunkte: **4 × 4 px** und **2 × 2 px**.
- Zehn Emotes in einer weißen Blase, jeweils **12 × 12 px**:
  Achtung, Frage, Idee, Herz, Schweiß, Fertig, Fehler, Musik, Kaffee und Warten.
- Schlafzeichen `z`: drei **12 × 12 px** große Frames, **320 ms** je Frame;
  das Zeichen wächst und wandert nach oben rechts.
- Graues Arbeitszahnrad: vier **8 × 8 px** große Frames, **140 ms** je Frame;
  fester Mittelpunkt und Beleuchtung von oben links.

Die neue Datei ist `public/assets/office/fx/bubbles.png` (**64 × 64 px**).
Sie ergänzt den Atlas um **38 Sprites und zwei Animationen**.

| Bereich im Blatt | Inhalt |
| --- | --- |
| x 0–11, y 0–11 | Sprechblase: neun Teile, zeilenweise |
| x 16–27, y 0–11 | Denkblase: neun Teile, zeilenweise |
| x 32, y 0 | Sprechblasenschwanz, 4 × 4 |
| x 40 / 48, y 0 | großer / kleiner Gedankenpunkt |
| y 16 / 28 | Emotes: zwei Reihen mit je fünf 12 × 12 Feldern |
| y 44 | drei Schlaf-Frames nebeneinander |
| y 56 | vier Zahnrad-Frames nebeneinander |

## Vorschauen

- `checks/emotes-overview.png`: alle neuen Assets exakt 3-fach vergrößert.
- `checks/emotes-in-office.gif`: 60 Bilder einer Montage über beiden Figuren.
  Die rechte Figur pausiert beim Schlafsymbol mit der vorhandenen Ruhepose;
  eine eigene Schlaf-Körperanimation gehört nicht zu diesem Blatt.
- `checks/animation-overview.gif` und `checks/work-at-desks.gif`: bisherige
  Figuren- und Arbeitsvorschauen.
- `checks/room-native.png`: bisherige Raummontage in Originalauflösung.

## Einbau

`public/assets/office/atlas.json` enthält die vollständigen Ausschnitte,
Bildgrößen, Animationszeiten, Anker, Farbaustauschmasken und Montagepunkte.
Die Grundstruktur bleibt `schemaVersion: 2`.

1. Bilder ohne Glättung laden und **3× mit Nearest Neighbor** anzeigen.
2. Blasen mit `nineSlice.bubble-speech` bzw. `nineSlice.bubble-thought`
   zusammensetzen. Eckteile bleiben 4 × 4; Kanten und Mitte werden wiederholt.
   Mindestmaß ist 12 × 12 px. Die Denkblase auf Vielfache von vier Pixeln
   aufrunden, damit der Wellenrhythmus an den Ecken stimmt.
3. `overhead` enthält Schwanz, Gedankenpunkte, Emote-IDs und Statusanimationen.
   Der empfohlene Montagepunkt liegt zwei Pixel über einer 32 px hohen Figur:
   Fußpunkt plus `[0, -34]`. Die UI wird nach Figuren und Möbeln gezeichnet.
4. Sprechblasenschwanz bei `bodyHeight - 1` ansetzen; seine weiße obere Zeile
   öffnet den Anschluss. Gedankenpunkte unterhalb des Körpers gemäß
   `offsetFromBodyBottomCenter` zeichnen.
5. Namen und frei wählbare Texte zeichnet der Code in den weißen Innenraum.
   **Im Spriteblatt ist kein Text eingebrannt.** `!`, `?` und `z` sind die im
   Ausgangsdokument erlaubten Bildzeichen. Noten, Häkchen und Kreuz sind Icons.
6. Deckkraft oder Ausblenden bei Bedarf im Code anwenden. Die PNGs selbst haben
   ausschließlich Alpha 0 oder 255.

Vorhandene Figuren bleiben **16 × 32 px**, mit Fußlinie bei 32 und Anker
`[8, 32]`. Linksgehen spiegelt die Rechtsanimation. Farbtausch gilt ausschließlich
für die drei Schlüsselfarben in Figuren-Blättern und ihre Masken; blaue Emotes
dürfen nicht mit eingefärbt werden. Details zu Figuren, Requisiten und
Hand-Vordergrund stehen in `docs/animations.md` und `docs/characters.md`.

## Erneut erstellen

Python 3 mit Pillow und NumPy gemäß `tools/requirements.txt` verwenden:

```bash
python3 -m pip install -r tools/requirements.txt
python3 tools/prepare_emotes.py
```

Der Befehl baut zuerst alle vorherigen Stufen, ergänzt den Atlas und erzeugt
Vorschauen sowie `checks/emotes-quality.json`. Ältere `prepare_*.py`-Skripte allein
erzeugen jeweils nur den damaligen Atlasstand. Für den aktuellen Gesamtstand
deshalb immer **prepare_emotes.py** ausführen.

Der aktuelle Bericht prüft Palette, binäre Transparenz, Atlasgrenzen,
überlappungsfreie Ausschnitte, weiße Blaseninnenräume ohne Löcher bei mehreren
Größen, zehn unterschiedliche Emotes, aufsteigende und wachsende Schlafzeichen,
vier unterschiedliche Zahnrad-Silhouetten mit festem Mittelpunkt und die
tatsächlich exportierten GIF-Pixel. Ältere Berichte dokumentieren die jeweiligen
Zwischenstände; ihre damaligen Spritezahlen sind absichtlich erhalten.

## Quellen und Nachbearbeitung

Die drei neuen Ausgangsbilder wurden mit der integrierten Bildgenerierung
erstellt. `art/raw/` bewahrt sie unverändert, `art/prompts/` enthält die vollständigen
englischen Prompts. Stilreferenz war `art/style-anchor.png`; für die Emotes diente
zusätzlich das neue Blasenblatt als Formenreferenz. Es wurden keine Fremdassets
eingebaut und keine Veröffentlichung vorgenommen.

`art/emote-source.json` hält Prüfsummen, Ausschnitte, Zielmaße und Pixelkorrekturen
fest. Die Nachbearbeitung reduziert auf ENDESGA 32, schließt Konturen und
vereinheitlicht Blasenkörper. Bei Glühbirne, Kreuz und Sanduhr wurden in der
nativen Auflösung Details nachgezogen, die beim Verkleinern verloren gingen.
Die vier Zahnradphasen werden aus dem ersten generierten Zahnrad um einen festen
Mittelpunkt abgeleitet; die Lichtseite bleibt dabei oben links.

Bisheriger Aufbau und frühere Hinweise sind in `docs/` archiviert.
Effektblätter wie Konfetti, Staub und Auswahlring gehören gemäß Ausgangsplan
zu Stufe 2 und sind noch nicht Teil dieses Pakets.
