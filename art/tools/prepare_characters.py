#!/usr/bin/env python3
"""Build two 16x32 character turnarounds with verified clothing recoloring."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import prepare_furniture as furniture

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/assets/office"
room = furniture.room
rgba = room.rgba
KEY_HEX = ["2ce8f5", "0099db", "124e89"]
KEYS = [rgba(h) for h in KEY_HEX]
GREEN = ["63c74d", "3e8948", "265c42"]
RED = ["f6757a", "e43b44", "a22633"]
VIEWS = ("front", "back", "right")
PALETTES = {
    "look-01": ["181425", "262b44", "3a4466", "5a6988", "c0cbdc", "ffffff",
                "733e39", "b86f50", "c28569", *KEY_HEX],
    "look-02": ["181425", "262b44", "3a4466", "5a6988", "c0cbdc",
                "ead4aa", "e8b796", "c28569", "733e39", "b86f50", "be4a2f", "d77643", *KEY_HEX],
}


def key_mask(pixels: np.ndarray) -> np.ndarray:
    return np.logical_or.reduce([np.all(pixels == key, axis=2) for key in KEYS])


def recolor(pixels: np.ndarray, shades: list[str]) -> np.ndarray:
    """Swap from the original source, so replacements never cascade."""
    output = pixels.copy()
    for original, replacement in zip(KEYS, shades):
        output[np.all(pixels == original, axis=2)] = rgba(replacement)
    return output


def normalize(source: Image.Image, look: str, item: dict, max_width: int) -> np.ndarray:
    x0, y0, x1, y1 = item["box"]
    start, end = item["torsoY"]
    # Keep one common horizontal scale for every view of this person.
    width = max(1, min(14, round((x1 - x0) * 14 / max_width)))
    output = np.zeros((32, 16, 4), dtype=np.uint8)
    left = (16 - width) // 2
    # Normalize the oversized source heads to one third of the game sprite.
    strips = [(y0, y0 + start, 1, 11),
              (y0 + start, y0 + end, 12, 9),
              (y0 + end, y1, 21, 11)]
    for sy0, sy1, ty, height in strips:
        pixels = room.raster(source, [x0, sy0, x1, sy1], (width, height), PALETTES[look])
        output[ty:ty + height, left:left + width] = pixels
    output = furniture.outlined(output)
    if look == "look-01" and item["view"] == "front":
        # Keep the generated round spectacles legible at one logical pixel
        # per lens highlight: diamond-shaped 3x3 rims with brown corners.
        for cx in (5, 10):
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    y, x = 8 + dy, cx + dx
                    if output[y, x, 3] != 255:
                        continue
                    output[y, x] = rgba("c0cbdc") if dx == dy == 0 else rgba("b86f50") if dx and dy else room.NAVY
        output[8, 7:9] = room.NAVY
    # Blue reflections and trouser tints must never become recolorable fabric.
    allowed = np.zeros((32, 16), dtype=bool)
    allowed[12:21] = True
    for original, replacement in zip(KEYS, ("c0cbdc", "5a6988", "3a4466")):
        invalid = np.all(output == original, axis=2) & ~allowed
        output[invalid] = rgba(replacement)
    mask = key_mask(output)
    ys, xs = np.where(mask)
    if len(ys) < 6:
        raise ValueError(f"Clothing mask lost for {look}/{item['view']}")
    # Preserve all three semantic shades even when area reduction removes one.
    for i, original in enumerate(KEYS):
        if np.all(output == original, axis=2).any():
            continue
        if i == 0:
            order = np.argsort(ys * 16 + xs)
        elif i == 2:
            order = np.argsort(-(ys * 16 + xs))
        else:
            order = np.argsort((ys - 16) ** 2 + (xs - 8) ** 2)
        for index in order:
            old = output[ys[index], xs[index]]
            if np.all(output == old, axis=2).sum() > 1:
                output[ys[index], xs[index]] = original
                break
    return output


def add_characters(config: dict) -> dict:
    atlas = json.loads((OUT / "atlas.json").read_text(encoding="utf-8"))
    atlas["characters"] = {}
    for look, source_config in config["looks"].items():
        path = ROOT / source_config["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != source_config["sha256"]:
            raise ValueError(f"Unexpected source for {look}; review the crop coordinates first")
        source = Image.open(path).convert("RGBA")
        if list(source.size) != source_config["size"]:
            raise ValueError(f"Unexpected source dimensions for {look}")
        max_width = max(v["box"][2] - v["box"][0] for v in source_config["views"])
        sheet = np.zeros((32, 48, 4), dtype=np.uint8)
        names = {}
        for i, item in enumerate(source_config["views"]):
            pixels = normalize(source, look, item, max_width)
            sheet[:, i * 16:(i + 1) * 16] = pixels
            name = look + "-" + item["view"]
            names[item["view"]] = name
            atlas["sprites"][name] = {"image": f"characters/{look}/sheet.png", "x": i * 16, "y": 0,
                                      "width": 16, "height": 32, "frames": 1, "anchor": [8, 32],
                                      "feetBaseline": 32, "footprintTiles": [1, 1]}
        folder = OUT / "characters" / look
        folder.mkdir(parents=True, exist_ok=True)
        Image.fromarray(sheet).save(folder / "sheet.png")
        mask = np.zeros_like(sheet)
        mask[key_mask(sheet)] = rgba("ffffff")
        Image.fromarray(mask).save(folder / "recolor-mask.png")
        atlas["meta"]["images"][f"characters/{look}/sheet.png"] = {"width": 48, "height": 32}
        atlas["characters"][look] = {"role": source_config["role"], "appearance": source_config["appearance"],
                                     "views": names, "mirrorLeftFrom": "right", "anchor": [8, 32],
                                     "feetBaseline": 32, "frameSize": [16, 32],
                                     "recolorMask": f"characters/{look}/recolor-mask.png"}
    atlas["characterPaletteSwap"] = {"light": "#2ce8f5", "mid": "#0099db", "dark": "#124e89",
                                      "scope": "character sheets only", "greenExample": ["#" + h for h in GREEN],
                                      "redExample": ["#" + h for h in RED]}
    room.floors.save_json(OUT / "atlas.json", atlas)
    return atlas


def validate(atlas: dict) -> dict:
    images, sprites = room.read_sprites(atlas)
    assert len(sprites) == 59 and len(atlas["animations"]) == 5 and len(atlas["characters"]) == 2
    palette = set(room.floors.PALETTE)
    details = {}
    for look, character in atlas["characters"].items():
        image = images[f"characters/{look}/sheet.png"]
        assert image.shape == (32, 48, 4)
        assert set(np.unique(image[:, :, 3])) == {0, 255}
        assert {tuple(c) for c in image[image[:, :, 3] == 255, :3].tolist()} <= palette
        mask_image = np.asarray(Image.open(OUT / character["recolorMask"]).convert("RGBA"))
        mask = mask_image[:, :, 3] == 255
        assert np.array_equal(mask, key_mask(image))
        assert not mask[:12].any() and not mask[21:].any()
        assert set(np.unique(mask_image[:, :, 3])) == {0, 255}
        details[look] = {}
        for i, view in enumerate(VIEWS):
            entry = atlas["sprites"][character["views"][view]]
            assert (entry["x"], entry["y"], entry["width"], entry["height"]) == (i * 16, 0, 16, 32)
            assert entry["anchor"] == [8, 32] and entry["feetBaseline"] == 32
            frame = sprites[character["views"][view]]
            assert frame.shape == (32, 16, 4)
            yy, xx = np.where(frame[:, :, 3] == 255)
            assert yy.min() == 1 and yy.max() == 31, (look, view, yy.min(), yy.max())
            assert (frame[31, :, 3] > 0).any()
            assert not frame[:, 0, 3].any() and not frame[:, 15, 3].any(), "No horizontal margin"
            counts = [int(np.all(frame == key, axis=2).sum()) for key in KEYS]
            assert all(count > 0 for count in counts), (look, view, counts)
            details[look][view] = {"feetBaseline": 32, "shadePixelCounts": counts}
        for shades in (GREEN, RED):
            swapped = recolor(image, shades)
            assert np.array_equal(swapped[~mask], image[~mask]), "Recolor altered skin, hair or another material"
            assert np.array_equal(swapped[:, :, 3], image[:, :, 3])
            assert np.any(swapped != image)
            for key, target in zip(KEYS, shades):
                region = np.all(image == key, axis=2)
                assert np.all(swapped[region] == rgba(target))
    # Visible identity details must survive at the real game resolution.
    woman = sprites["look-01-front"][:11]
    lens = np.all(woman[:, :, :3] == rgba("c0cbdc")[:3], axis=2) | np.all(woman[:, :, :3] == rgba("ffffff")[:3], axis=2)
    assert lens.sum() >= 2, "Spectacle highlights lost"
    for view in ("front", "right"):
        man = sprites[f"look-02-{view}"][:12]
        beard = np.all(man[:, :, :3] == rgba("be4a2f")[:3], axis=2) | np.all(man[:, :, :3] == rgba("d77643")[:3], axis=2)
        assert beard.any(), f"Red beard lost in {view}"
    assert json.loads((ROOT / "art/checks/furniture-quality.json").read_text())["status"] == "passed"
    return {"status": "passed", "totalSprites": 59, "characterLooks": 2, "characterViews": 6,
            "frameSize": [16, 32], "sheetSize": [48, 32], "feetBaseline": 32,
            "alphaLevels": [0, 255], "palette": "ENDESGA 32", "clothingKeyColors": ["#" + h for h in KEY_HEX],
            "allThreeShadesPerView": "passed", "keyColorsOnlyOnClothing": "passed", "atlasViewPositions": "passed",
            "recolorPreservesAllOtherPixels": "passed", "spectaclesAndRedBeardPreserved": "passed",
            "previousStageChecks": "passed", "previewScale": 3, "views": details,
            "characterAnimationsCreated": False}


def previews(atlas: dict) -> None:
    _, sprites = room.read_sprites(atlas)
    canvas = Image.new("RGB", (800, 560), "#181425")
    draw = ImageDraw.Draw(canvas)
    def text(x, y, value, size=14, bold=False, fill="#c0cbdc"):
        draw.text((x, y), value, font=furniture.font(size, bold), fill=fill)
    def show(frame: np.ndarray, x: int, y: int):
        draw.rectangle((x - 8, y - 4, x + 55, y + 99), fill="#8b9bb4", outline="#5a6988")
        image = Image.fromarray(frame).resize((48, 96), Image.Resampling.NEAREST)
        canvas.paste(image, (x, y), image)
    text(32, 22, "Pixel-Büro · Grundfiguren", 26, True, "#ffffff")
    text(32, 64, "16 × 32 px je Ansicht · exakt 3× ohne Glättung · Kleidung per Farbtausch", 14)
    for look, y, title in (("look-01", 104, "Hauptsitzung · Weste"), ("look-02", 314, "Subagent · T-Shirt")):
        text(32, y, title, 18, True, "#ffffff")
        text(432, y, "Farbtausch: nur Kleidung", 17, True, "#ffffff")
        for view, label, x in (("front", "vorn", 48), ("back", "hinten", 144), ("right", "rechts", 240)):
            text(x, y + 36, label)
            show(sprites[f"{look}-{view}"], x, y + 60)
        front = sprites[f"{look}-front"]
        for frame, label, x in ((front, "Blau", 432), (recolor(front, GREEN), "Grün", 544), (recolor(front, RED), "Rot", 656)):
            text(x, y + 36, label)
            show(frame, x, y + 60)
    text(32, 516, "Geprüft: gemeinsame Fußlinie, Palette, Transparenz und unveränderte Pixel außerhalb der Kleidung.", 13)
    canvas.save(ROOT / "art/checks/characters-preview.png")
    native = Image.open(ROOT / "art/checks/room-native.png").convert("RGBA")
    # Standing poses in the aisle, at the actual game scale. No seated pose implied.
    for key, ground in (("look-01-right", (144, 128)), ("look-02-front", (96, 136))):
        native.alpha_composite(Image.fromarray(sprites[key]), (ground[0] - 8, ground[1] - 32))
    montage = Image.new("RGB", (1024, 850), "#181425")
    md = ImageDraw.Draw(montage)
    md.text((32, 20), "Pixel-Büro · Figuren im Raum", font=furniture.font(25, True), fill="#ffffff")
    md.text((32, 57), "Standansichten im Maßstab der Möbel · Ansicht 3× ohne Glättung", font=furniture.font(15), fill="#c0cbdc")
    enlarged = native.resize((960, 720), Image.Resampling.NEAREST)
    montage.paste(enlarged, (32, 90), enlarged)
    md.text((32, 822), "Geh- und Arbeitsanimationen folgen nach der Abstimmung der Grundfiguren.", font=furniture.font(13), fill="#c0cbdc")
    montage.save(ROOT / "art/checks/characters-in-room.png")


def main() -> None:
    furniture.main()
    config = json.loads((ROOT / "art/characters-source.json").read_text(encoding="utf-8"))
    atlas = add_characters(config)
    report = validate(atlas)
    previews(atlas)
    room.floors.save_json(ROOT / "art/checks/characters-quality.json", report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
