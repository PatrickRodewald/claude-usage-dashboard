"""Render the shipped atlas and verify actual exported animation pixels."""
from __future__ import annotations

from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

import prepare_characters as chars

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/assets/office"
room, furniture = chars.room, chars.furniture


def palette_image() -> Image.Image:
    palette = Image.new("P", (1, 1))
    palette.putpalette([v for c in room.floors.PALETTE for v in c] + [0] * 672)
    return palette


def foreground(atlas: dict, animation: dict, index: int) -> Image.Image | None:
    if "foregroundImage" not in animation:
        return None
    entry = atlas["sprites"][animation["states"][index]]
    image = Image.open(OUT / animation["foregroundImage"]).convert("RGBA")
    return image.crop((entry["x"], entry["y"], entry["x"] + 16, entry["y"] + 32))


def prop_sprite(atlas: dict, sprites: dict, animation: dict, index: int) -> Image.Image | None:
    prop = animation.get("prop")
    if not prop:
        return None
    if "sprite" in prop:
        return sprites[prop["sprite"]]
    prop_animation = atlas["animations"][prop["animation"]]
    prop_index = prop["frameMap"][index]
    return sprites[prop_animation["states"][prop_index]]


def composite(atlas: dict, sprites: dict, animation: dict, index: int) -> Image.Image:
    image = sprites[animation["states"][index]].copy()
    prop = prop_sprite(atlas, sprites, animation, index)
    if prop is not None:
        image.alpha_composite(prop, tuple(animation["prop"]["mount"]))
        hands = foreground(atlas, animation, index)
        if hands is not None:
            image.alpha_composite(hands)
    return image


def check_gif(path: Path, expected: list[list[tuple[Image.Image, tuple[int, int], str]]]) -> None:
    gif = Image.open(path)
    assert gif.n_frames == len(expected), (path.name, gif.n_frames, len(expected))
    for i, regions in enumerate(expected):
        gif.seek(i)
        actual = gif.convert("RGB")
        for image, (x, y), background in regions:
            flat = Image.new("RGB", image.size, background)
            flat.paste(image, mask=image)
            crop = actual.crop((x, y, x + image.width, y + image.height))
            assert np.array_equal(np.asarray(flat), np.asarray(crop)), (path.name, i, x, y)


def overview(atlas: dict, sprites: dict) -> None:
    labels = (("walk-front", "vorn"), ("walk-back", "hinten"), ("walk-right", "rechts"), ("idle", "atmen"),
              ("type", "tippen"), ("read", "lesen"), ("write", "schreiben"), ("think", "denken"))
    frames, checks = [], []
    palette = palette_image()
    for step in range(24):
        time_ms = step * 120
        canvas = Image.new("RGB", (1080, 492), "#181425")
        draw = ImageDraw.Draw(canvas)
        draw.text((32, 20), "Pixel-Büro · Geh- und Arbeitsanimationen", font=furniture.font(26, True), fill="#ffffff")
        draw.text((32, 62), "Freigegebene Figuren · 16 × 32 px · Ansicht exakt 3× ohne Glättung", font=furniture.font(14), fill="#c0cbdc")
        for c, (_, label) in enumerate(labels):
            draw.text((48 + c * 128, 102), label, font=furniture.font(14), fill="#c0cbdc")
        regions = []
        for look, top, title in (("look-01", 166, "Hauptsitzung"), ("look-02", 340, "Subagent")):
            draw.text((32, top - 34), title, font=furniture.font(16, True), fill="#ffffff")
            for c, (action, _) in enumerate(labels):
                animation = atlas["animations"][f"{look}-{action}"]
                index = (time_ms // animation["frameDurationMs"]) % animation["frames"]
                image = composite(atlas, sprites, animation, index).resize((48, 96), Image.Resampling.NEAREST)
                x = 48 + c * 128
                draw.rectangle((x - 8, top - 4, x + 55, top + 99), fill="#8b9bb4", outline="#5a6988")
                canvas.paste(image, (x, top), image)
                regions.append((image, (x, top), "#8b9bb4"))
        draw.text((32, 470), "Buch, Notizblock und Laptop werden separat unter den Hand-Vordergrund gezeichnet.", font=furniture.font(13), fill="#c0cbdc")
        frames.append(canvas.quantize(palette=palette, dither=Image.Dither.NONE))
        checks.append(regions)
    path = ROOT / "art/checks/animation-overview.gif"
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=120, loop=0, disposal=2, optimize=False)
    check_gif(path, checks)


def workbench(atlas: dict, sprites: dict) -> None:
    frames, checks = [], []
    palette = palette_image()
    tasks = (("type", "Tippen"), ("read", "Lesen"), ("write", "Schreiben"), ("think", "Nachdenken"))
    for step in range(12):
        action, title = tasks[step // 3]
        index = step % 3
        scene = Image.new("RGBA", (192, 80))
        for y in range(5):
            for x in range(12):
                scene.alpha_composite(sprites["wood-a" if (x + y) % 2 else "wood-b"], (x * 16, y * 16))
        for look, x in (("look-01", 16), ("look-02", 112)):
            animation = atlas["animations"][f"{look}-{action}"]
            origin = (x + 16, 24)
            scene.alpha_composite(sprites[animation["states"][index]], origin)
            scene.alpha_composite(sprites["desk-large"], (x, 40))
            scene.alpha_composite(sprites["lamp-on"], (x + 1, 35))
            scene.alpha_composite(sprites["mug-steam-2"], (x + 36, 38))
            prop = prop_sprite(atlas, sprites, animation, index)
            if prop is not None:
                mx, my = animation["prop"]["mount"]
                scene.alpha_composite(prop, (origin[0] + mx, origin[1] + my))
            hands = foreground(atlas, animation, index)
            if hands is not None:
                scene.alpha_composite(hands, origin)
        canvas = Image.new("RGB", (640, 350), "#181425")
        draw = ImageDraw.Draw(canvas)
        draw.text((32, 20), "Pixel-Büro · " + title, font=furniture.font(25, True), fill="#ffffff")
        image = scene.resize((576, 240), Image.Resampling.NEAREST)
        canvas.paste(image, (32, 70), image)
        draw.text((32, 326), "Montageprüfung · Figur/Stuhl, Tisch, Requisit, Hände · 3×", font=furniture.font(13), fill="#c0cbdc")
        frames.append(canvas.quantize(palette=palette, dither=Image.Dither.NONE))
        checks.append([(image, (32, 70), "#181425")])
    path = ROOT / "art/checks/work-at-desks.gif"
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=240, loop=0, disposal=2, optimize=False)
    check_gif(path, checks)


def contact_sheet(atlas: dict) -> None:
    canvas = Image.new("RGB", (1080, 800), "#181425")
    draw = ImageDraw.Draw(canvas)
    draw.text((32, 24), "Pixel-Büro · Animationsblätter", font=furniture.font(26, True), fill="#ffffff")
    draw.text((32, 66), "Vier Figurenblätter und separate Requisiten · Originalgrafiken exakt 3×", font=furniture.font(14), fill="#c0cbdc")
    for image, x, title in (("characters/look-01/walk.png", 32, "Hauptsitzung · Gehen"),
                             ("characters/look-02/walk.png", 296, "Subagent · Gehen"),
                             ("characters/look-01/desk-work.png", 560, "Hauptsitzung · Arbeit"),
                             ("characters/look-02/desk-work.png", 824, "Subagent · Arbeit")):
        sprite = Image.open(OUT / image).convert("RGBA")
        enlarged = sprite.resize((sprite.width * 3, sprite.height * 3), Image.Resampling.NEAREST)
        draw.text((x, 110), title, font=furniture.font(15, True), fill="#ffffff")
        draw.rectangle((x - 4, 144, x + enlarged.width + 3, 151 + enlarged.height), fill="#8b9bb4")
        canvas.paste(enlarged, (x, 148), enlarged)
    draw.text((32, 558), "Gehen: vorn / hinten / rechts / atmen. Arbeit: tippen / lesen / schreiben / denken.", font=furniture.font(14), fill="#c0cbdc")
    draw.text((32, 610), "Separate Requisiten: Buch (4 Bilder), Notizblock mit Stift (3 Bilder)", font=furniture.font(16, True), fill="#ffffff")
    props = Image.open(OUT / "props/work-a.png").convert("RGBA").resize((192, 96), Image.Resampling.NEAREST)
    draw.rectangle((28, 650, 227, 753), fill="#8b9bb4")
    canvas.paste(props, (32, 654), props)
    draw.text((296, 660), "Figuren: 16 × 32 px je Bild", font=furniture.font(15), fill="#c0cbdc")
    draw.text((296, 688), "52 neue Figurenframes · 7 Requisitenframes", font=furniture.font(15), fill="#c0cbdc")
    draw.text((296, 716), "ENDESGA 32 · Alpha nur 0 oder 255", font=furniture.font(15), fill="#c0cbdc")
    canvas.save(ROOT / "art/checks/animation-sheets.png")


def build(atlas: dict) -> dict:
    _, arrays = room.read_sprites(atlas)
    sprites = {key: Image.fromarray(pixels) for key, pixels in arrays.items()}
    overview(atlas, sprites)
    workbench(atlas, sprites)
    contact_sheet(atlas)
    return {"overviewGifFrames": 24, "workbenchGifFrames": 12, "exportedGifPixelsMatchAtlas": True}
