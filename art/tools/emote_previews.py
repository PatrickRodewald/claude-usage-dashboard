"""Show native-size overhead assets and verify the exported preview animation."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import prepare_emotes as emotes
import animation_previews as work

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/assets/office"
LABELS = ("Achtung", "Frage", "Idee", "Herz", "Schweiß", "Fertig", "Fehler", "Musik", "Kaffee", "Warten")


def pixel_text(image: Image.Image, text: str, xy: tuple[int, int]) -> None:
    # A tiny bitmap preview font keeps small in-world text readable and crisp.
    # This font is code, never part of the delivered bubble sprites.
    glyphs = {
        "B": ("1110", "1001", "1110", "1001", "1001", "1110"),
        "E": ("1111", "1000", "1110", "1000", "1000", "1111"),
        "R": ("1110", "1001", "1110", "1010", "1001", "1001"),
        "I": ("1110", "0100", "0100", "0100", "0100", "1110"),
        "T": ("1111", "0100", "0100", "0100", "0100", "0100"),
        "N": ("1001", "1101", "1101", "1011", "1011", "1001"),
        "D": ("1110", "1001", "1001", "1001", "1001", "1110"),
        ".": ("0000", "0000", "0000", "0000", "0000", "0100"),
        "!": ("0100", "0100", "0100", "0100", "0000", "0100"),
        " ": ("0000",) * 6}
    x, y = xy
    for char in text.upper():
        for row, line in enumerate(glyphs[char]):
            for column, bit in enumerate(line):
                if bit == "1":
                    image.putpixel((x + column, y + row), emotes.NAVY)
        x += 5


def bubble(atlas: dict, sprites: dict, kind: str, width: int, height: int, text: str) -> Image.Image:
    spec = atlas["nineSlice"]["bubble-" + kind]
    pieces = {position: np.asarray(sprites[key]) for position, key in spec["pieces"].items()}
    body = Image.fromarray(emotes.assemble(pieces, width, height))
    pixel_text(body, text, (4, 3))
    image = Image.new("RGBA", (width, height + (3 if kind == "speech" else 8)))
    image.alpha_composite(body)
    if kind == "speech":
        image.alpha_composite(sprites["bubble-speech-tail"], (width // 2 - 2, height - 1))
    else:
        image.alpha_composite(sprites["bubble-thought-puff-large"], (width // 2 - 2, height + 1))
        image.alpha_composite(sprites["bubble-thought-puff-small"], (width // 2, height + 6))
    return image


def enlarged(image: Image.Image) -> Image.Image:
    return image.resize((image.width * 3, image.height * 3), Image.Resampling.NEAREST)


def contact_sheet(atlas: dict, sprites: dict) -> None:
    image = Image.new("RGB", (1000, 720), "#181425")
    draw = ImageDraw.Draw(image)
    draw.text((32, 22), "Pixel-Büro · Sprechblasen und Emotes", font=emotes.furniture.font(26, True), fill="#ffffff")
    draw.text((32, 64), "Zehn Symbole · zwei dehnbare Blasen · zwei Animationen · alle Grafiken exakt 3×", font=emotes.furniture.font(14), fill="#c0cbdc")
    for i, (key, label) in enumerate(zip(emotes.EMOTES, LABELS)):
        r, c = divmod(i, 5)
        x, y = 32 + c * 188, 104 + r * 120
        draw.rounded_rectangle((x, y, x + 174, y + 102), radius=8, fill="#3a4466")
        icon = enlarged(sprites["emote-" + key])
        image.paste(icon, (x + 69, y + 18), icon)
        draw.text((x + 12, y + 74), label, font=emotes.furniture.font(14), fill="#ffffff")
    draw.text((32, 360), "Dehnbare Blasen · Text wird vom Code gezeichnet", font=emotes.furniture.font(17, True), fill="#ffffff")
    for kind, x, w, h, text in (("speech", 32, 60, 20, "Bereit."), ("thought", 300, 68, 24, "Eine Idee!")):
        sprite = enlarged(bubble(atlas, sprites, kind, w, h, text))
        image.paste(sprite, (x, 400), sprite)
        draw.text((x, 505), "Sprechen" if kind == "speech" else "Denken", font=emotes.furniture.font(14), fill="#c0cbdc")
    draw.text((32, 552), "Schlafen · 3 Bilder", font=emotes.furniture.font(16, True), fill="#ffffff")
    for i in range(3):
        sprite = enlarged(sprites[f"sleep-z-{i}"])
        draw.rectangle((32 + i * 56, 584, 75 + i * 56, 627), fill="#8b9bb4")
        image.paste(sprite, (36 + i * 56, 588), sprite)
    draw.text((280, 552), "Arbeiten · 4 Bilder", font=emotes.furniture.font(16, True), fill="#ffffff")
    for i in range(4):
        sprite = enlarged(sprites[f"working-gear-{i}"])
        draw.rectangle((280 + i * 44, 584, 315 + i * 44, 619), fill="#8b9bb4")
        image.paste(sprite, (286 + i * 44, 590), sprite)
    draw.text((704, 360), "Originalblatt · 64 × 64 px", font=emotes.furniture.font(15, True), fill="#ffffff")
    sprite = enlarged(Image.open(OUT / "fx/bubbles.png").convert("RGBA"))
    draw.rectangle((700, 396, 899, 595), fill="#8b9bb4")
    image.paste(sprite, (704, 400), sprite)
    draw.text((704, 614), "ENDESGA 32 · Alpha 0/255", font=emotes.furniture.font(13), fill="#c0cbdc")
    draw.text((32, 674), "Stufe 1: Grafikpaket komplett. Nächster Schritt: Canvas-Raum mit zwei Figuren und Wegfindung.", font=emotes.furniture.font(14), fill="#c0cbdc")
    image.save(ROOT / "art/checks/emotes-overview.png")


def office_preview(atlas: dict, sprites: dict) -> None:
    frames, checks = [], []
    palette = work.palette_image()
    for step in range(60):
        t = step * 160
        scene = Image.new("RGBA", (256, 104))
        for y in range(0, 104, 16):
            for x in range(0, 256, 16):
                scene.alpha_composite(sprites["wood-a" if (x + y) % 32 else "wood-b"], (x, y))
        for x in range(0, 256, 16):
            scene.alpha_composite(sprites["wall-plain"], (x, 0))
        for look, x in (("look-01", 32), ("look-02", 160)):
            action = "think" if look == "look-01" and 16 <= step < 32 else "idle" if look == "look-02" and 40 <= step < 52 else "type"
            animation = atlas["animations"][look + "-" + action]
            index = (t // animation["frameDurationMs"]) % animation["frames"]
            origin = (x + 16, 64)
            if not animation.get("includesChair"):
                scene.alpha_composite(sprites["chair-front"], (x + 16, 72))
            scene.alpha_composite(sprites[animation["states"][index]], origin)
            scene.alpha_composite(sprites["desk-large"], (x, 80))
            scene.alpha_composite(sprites["lamp-on"], (x + 1, 75))
            prop = work.prop_sprite(atlas, sprites, animation, index)
            if prop is not None:
                mx, my = animation["prop"]["mount"]
                scene.alpha_composite(prop, (origin[0] + mx, origin[1] + my))
            hands = work.foreground(atlas, animation, index)
            if hands is not None:
                scene.alpha_composite(hands, origin)
        kind = "thought" if 16 <= step < 32 else "speech"
        left_bubble = bubble(atlas, sprites, kind, 56, 16, "Eine Idee!" if kind == "thought" else "Bereit.")
        scene.alpha_composite(left_bubble, (28, 36))
        if step < 40:
            number = step // 4
            sprite = sprites["emote-" + emotes.EMOTES[number]]
            label = LABELS[number]
        elif step < 52:
            animation = atlas["animations"]["sleep-z"]
            sprite = sprites[animation["states"][(t // animation["frameDurationMs"]) % 3]]
            label = "Schlafen"
        else:
            animation = atlas["animations"]["working-gear"]
            sprite = sprites[animation["states"][(t // animation["frameDurationMs"]) % 4]]
            label = "Arbeiten"
        scene.alpha_composite(sprite, (178, 48))
        canvas = Image.new("RGB", (824, 440), "#181425")
        draw = ImageDraw.Draw(canvas)
        draw.text((28, 18), "Pixel-Büro · " + label, font=emotes.furniture.font(25, True), fill="#ffffff")
        draw.text((28, 54), "Sprech- und Denkblasen, Emotes und Statusanimationen über den Figuren", font=emotes.furniture.font(14), fill="#c0cbdc")
        view = enlarged(scene)
        canvas.paste(view, (28, 86), view)
        draw.text((28, 416), "Montageprüfung · Originalgrafiken 3× ohne Glättung · Text separat gezeichnet", font=emotes.furniture.font(13), fill="#c0cbdc")
        frames.append(canvas.quantize(palette=palette, dither=Image.Dither.NONE))
        checks.append([(view, (28, 86), "#181425")])
    path = ROOT / "art/checks/emotes-in-office.gif"
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=160, loop=0, disposal=2, optimize=False)
    work.check_gif(path, checks)


def build(atlas: dict) -> dict:
    _, arrays = emotes.room.read_sprites(atlas)
    sprites = {key: Image.fromarray(p) for key, p in arrays.items()}
    contact_sheet(atlas, sprites)
    office_preview(atlas, sprites)
    return {"officePreviewGifFrames": 60, "exportedGifPixelsMatchAtlas": True, "textSeparateFromSpriteSheet": True}
