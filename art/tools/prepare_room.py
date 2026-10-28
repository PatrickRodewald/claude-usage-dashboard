#!/usr/bin/env python3
"""Build and verify the floor, wall and door assets from preserved source PNGs."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

import prepare_floors as floors

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/assets/office"
NAVY = (24, 20, 37, 255)
WOOD = ["e4a672", "b86f50", "733e39"]
WALL_COLORS = ["ead4aa", *WOOD, "181425"]
DOOR_COLORS = ["181425", "262b44", "733e39", "b86f50", "d77643", "feae34", "fee761"]
GLASS_COLORS = ["181425", "262b44", "5a6988", "8b9bb4", "c0cbdc", "2ce8f5", "ffffff"]


def rgba(h: str) -> tuple[int, int, int, int]:
    return (*bytes.fromhex(h), 255)


def raster(image: Image.Image, box: list[int], size: tuple[int, int], colors: list[str]) -> np.ndarray:
    """Quantize area modes, rejecting source alpha fringes before sampling."""
    crop = np.asarray(image.crop(tuple(box)).convert("RGBA"))
    palette = np.array([tuple(bytes.fromhex(h)) for h in colors], dtype=np.float32)
    delta = crop[:, :, None, :3].astype(np.float32) - palette[None, None, :, :]
    ids = (delta ** 2).sum(3).argmin(2)
    width, height = size
    ch, cw = ids.shape
    output = np.zeros((height, width, 4), dtype=np.uint8)
    for y in range(height):
        for x in range(width):
            sy = slice(y * ch // height, (y + 1) * ch // height)
            sx = slice(x * cw // width, (x + 1) * cw // width)
            alpha = crop[sy, sx, 3] >= 192
            if alpha.mean() < 0.5:
                continue
            mode = np.bincount(ids[sy, sx][alpha], minlength=len(colors)).argmax()
            output[y, x] = (*palette[mode].astype(np.uint8), 255)
    return output


def load_source(config: dict, key: str) -> Image.Image:
    item = config[key]
    file = ROOT / item["file"]
    if hashlib.sha256(file.read_bytes()).hexdigest() != item["sha256"]:
        raise ValueError(f"Unexpected {key} source; review crop coordinates before rebuilding")
    image = Image.open(file).convert("RGBA")
    if list(image.size) != item["size"]:
        raise ValueError(f"Unexpected {key} source size")
    return image


def make_walls(source: Image.Image, config: dict) -> dict[str, np.ndarray]:
    crops = config["walls"]["crops"]
    plain = raster(source, crops["plain"], (16, 32), WALL_COLORS)
    # Normalize broad plaster and horizontal trim; no outlines on cut edges.
    plain[4:29] = rgba("ead4aa")
    cap = [NAVY, rgba("e4a672"), rgba("b86f50"), NAVY]
    for y, c in enumerate(cap):
        plain[y] = c
    plain[29] = rgba("e4a672")
    plain[30] = rgba("b86f50")
    plain[31] = NAVY
    panel = raster(source, crops["wainscot"], (16, 32), WALL_COLORS)
    panel[:16] = plain[:16]
    panel[29:] = plain[29:]
    panel[16] = rgba("e4a672")
    panel[17] = rgba("733e39")
    panel[18:29] = rgba("b86f50")
    panel[18] = rgba("e4a672")
    # Four panels from the source, snapped to a period that repeats without seams.
    for x in (4, 8, 12):
        panel[19:29, x] = rgba("733e39")
    left = plain.copy()
    left[:, 0] = NAVY
    left[1:31, 1] = rgba("b86f50")
    right = left[:, ::-1].copy()
    side = np.zeros((16, 16, 4), dtype=np.uint8)
    for x, c in enumerate(cap):
        side[:, x] = c
    corner = np.zeros_like(side)
    for y in range(16):
        for x in range(16):
            if x >= 4 and y >= 4:
                continue
            if x == 0 or y == 0 or (x == 3 and y >= 4) or (y == 3 and x >= 4):
                corner[y, x] = NAVY
            elif x == 1 or y == 1:
                corner[y, x] = rgba("e4a672")
            else:
                corner[y, x] = rgba("b86f50")
    return {"wall-plain": plain, "wall-wainscot": panel,
            "wall-end-left": left, "wall-end-right": right,
            "wall-side-cap": side, "wall-outer-corner": corner,
            "wall-inner-corner": corner[::-1, ::-1].copy()}


def clean_leaf(frame: np.ndarray, kind: str, state: str) -> np.ndarray:
    """Close thin panel outlines and snap reflections to the logical pixel grid.

    Preserve the sampled outer frame. Simplify only the generated swinging
    leaf, whose fine source details would otherwise turn into isolated pixels.
    """
    image = Image.fromarray(frame)
    draw = ImageDraw.Draw(image)
    draw.rectangle((3, 3, 12, 30), fill=NAVY)
    if kind == "wood":
        fill, light, dark = rgba("b86f50"), rgba("d77643"), rgba("733e39")
        if state == "closed":
            draw.rectangle((3, 3, 12, 30), fill=fill, outline=dark)
            draw.line((4, 4, 11, 4), fill=light)
            for top, bottom in ((6, 14), (20, 28)):
                draw.rectangle((5, top, 10, bottom), outline=dark)
                draw.line((6, top + 1, 9, top + 1), fill=light)
            draw.point((11, 17), fill=rgba("fee761"))
            draw.point((11, 18), fill=rgba("feae34"))
        elif state == "half-open":
            draw.polygon(((3, 4), (8, 6), (8, 30), (3, 28)), fill=fill, outline=dark)
            draw.line((3, 4, 8, 6), fill=light)
            for top in (8, 20):
                draw.polygon(((4, top), (7, top + 1), (7, top + 7), (4, top + 6)), outline=dark)
            draw.point((7, 18), fill=rgba("fee761"))
        else:
            draw.line((3, 4, 3, 30), fill=fill)
            draw.line((4, 5, 4, 30), fill=light)
    else:
        metal, light, glass = rgba("8b9bb4"), rgba("c0cbdc"), rgba("2ce8f5")
        if state == "closed":
            draw.rectangle((3, 3, 12, 30), fill=metal)
            draw.line((4, 4, 11, 4), fill=light)
            draw.rectangle((4, 5, 11, 28), fill=glass)
            draw.line((5, 14, 9, 9), fill=rgba("ffffff"))
            draw.line((6, 20, 10, 15), fill=rgba("ffffff"))
            draw.rectangle((11, 17, 12, 21), fill=NAVY)
            draw.line((11, 18, 11, 20), fill=light)
        elif state == "half-open":
            draw.polygon(((3, 4), (8, 6), (8, 30), (3, 28)), fill=metal)
            draw.line((3, 4, 8, 6), fill=light)
            draw.polygon(((4, 6), (7, 8), (7, 27), (4, 26)), fill=glass)
            draw.line((4, 14, 6, 11), fill=rgba("ffffff"))
            draw.line((5, 20, 6, 18), fill=rgba("ffffff"))
            draw.rectangle((7, 17, 8, 20), fill=NAVY)
            draw.line((7, 18, 7, 19), fill=light)
        else:
            draw.line((3, 4, 3, 30), fill=light)
            draw.line((4, 5, 4, 30), fill=glass)
    return np.asarray(image).copy()


def make_doors(source: Image.Image, config: dict) -> dict[str, np.ndarray]:
    crops = config["doors"]["crops"]
    result = {}
    for kind, palette in (("wood", DOOR_COLORS), ("glass", GLASS_COLORS)):
        frames = [raster(source, box, (16, 32), palette) for box in crops[kind]]
        fixed = frames[0].copy()
        # Close the outer contour and align the visible frame, not the swinging leaf.
        fixed[0] = NAVY
        fixed[-1] = NAVY
        fixed[:, 0] = NAVY
        fixed[:, -1] = NAVY
        rim = np.zeros((32, 16), dtype=bool)
        rim[:3] = True
        rim[-1] = True
        rim[:, :3] = True
        rim[:, -3:] = True
        for state, frame in zip(("closed", "half-open", "open"), frames):
            frame = clean_leaf(frame, kind, state)
            frame[rim] = fixed[rim]
            # The source has a dark doorway behind the leaf; isolated transparent
            # gaps inside that aperture would reveal the wall or floor underneath.
            missing = frame[:, :, 3] == 0
            frame[missing] = rgba("181425")
            result[f"door-{kind}-{state}"] = frame
    for name, palette in (("plate-door", ["181425", "5a6988", "c0cbdc", "ffffff"]),
                          ("plate-brass", ["181425", "b86f50", "feae34", "fee761"])):
        plate = raster(source, crops[name], (16, 8), palette)
        plate[0] = plate[-1] = NAVY
        plate[:, 0] = plate[:, -1] = NAVY
        plate[1, 1:15] = rgba("ffffff" if name == "plate-door" else "fee761")
        plate[2:7, 1:15] = rgba("c0cbdc" if name == "plate-door" else "feae34")
        result[name] = plate
    return result


def write_sheets(walls: dict, doors: dict, atlas: dict) -> None:
    wall_sheet = Image.new("RGBA", (64, 48))
    door_sheet = Image.new("RGBA", (48, 80))
    for i, (name, pixels) in enumerate(walls.items()):
        x, y = (i * 16, 0) if i < 4 else ((i - 4) * 16, 32)
        sprite = Image.fromarray(pixels)
        wall_sheet.paste(sprite, (x, y))
        atlas["sprites"][name] = {"image": "tiles/walls.png", "x": x, "y": y,
                                  "width": sprite.width, "height": sprite.height, "frames": 1,
                                  "anchor": [0, sprite.height], "blocksMovement": True}
    for i, (name, pixels) in enumerate(doors.items()):
        x, y = ((i % 3) * 16, (i // 3) * 32) if i < 6 else ((i - 6) * 16, 64)
        sprite = Image.fromarray(pixels)
        door_sheet.paste(sprite, (x, y))
        entry = {"image": "tiles/doors.png", "x": x, "y": y,
                 "width": sprite.width, "height": sprite.height, "frames": 1,
                 "anchor": [0, sprite.height]}
        if i < 6:
            entry["blocksMovement"] = not name.endswith("-open") or name.endswith("half-open")
        atlas["sprites"][name] = entry
    wall_sheet.save(OUT / "tiles/walls.png")
    door_sheet.save(OUT / "tiles/doors.png")
    atlas["meta"].update({"schemaVersion": 2, "images": {
        "tiles/floor.png": {"width": 80, "height": 64},
        "tiles/walls.png": {"width": 64, "height": 48},
        "tiles/doors.png": {"width": 48, "height": 80}}})
    atlas["animations"] = {}
    for kind, y in (("wood", 0), ("glass", 32)):
        atlas["animations"][f"door-{kind}"] = {
            "image": "tiles/doors.png", "x": 0, "y": y, "width": 16, "height": 32,
            "frames": 3, "frameDurationMs": 150, "loop": False,
            "states": [f"door-{kind}-{state}" for state in ("closed", "half-open", "open")],
            "walkableFrame": 2, "anchor": [0, 32]}
    atlas["wallCaps"] = {"thicknessPixels": 4, "side": "wall-side-cap",
                         "outer": "wall-outer-corner", "inner": "wall-inner-corner",
                         "mirrorRightSide": True, "rotateCornersInCode": True}
    floors.save_json(OUT / "atlas.json", atlas)


def read_sprites(atlas: dict) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    images = {name: np.asarray(Image.open(OUT / name).convert("RGBA"))
              for name in atlas["meta"]["images"]}
    sprites = {}
    for name, s in atlas["sprites"].items():
        sprites[name] = images[s["image"]][s["y"]:s["y"] + s["height"], s["x"]:s["x"] + s["width"]]
    return images, sprites


def validate() -> dict:
    atlas = json.loads((OUT / "atlas.json").read_text(encoding="utf-8"))
    images, s = read_sprites(atlas)
    assert len(s) == 29 and len(atlas["animations"]) == 2
    palette = set(floors.PALETTE)
    all_colors = set()
    for name, pixels in images.items():
        expected = atlas["meta"]["images"][name]
        assert pixels.shape[:2] == (expected["height"], expected["width"])
        assert set(np.unique(pixels[:, :, 3])) <= {0, 255}
        visible = {tuple(c) for c in pixels[pixels[:, :, 3] == 255, :3].tolist()}
        assert visible <= palette, f"Out-of-palette color in {name}"
        all_colors |= visible
        coverage = np.zeros(pixels.shape[:2], dtype=np.uint8)
        for key, entry in atlas["sprites"].items():
            if entry["image"] != name:
                continue
            x, y, w, h = (entry[k] for k in ("x", "y", "width", "height"))
            assert x % 16 == y % 16 == 0
            assert 0 <= x <= pixels.shape[1] - w and 0 <= y <= pixels.shape[0] - h
            assert w == 16 and h in (8, 16, 32), key
            assert (s[key][:, :, 3] > 0).any(), f"Empty sprite: {key}"
            coverage[y:y + h, x:x + w] += 1
        assert coverage.max() == 1
        assert not pixels[coverage == 0, 3].any()
    for name in ("wall-plain", "wall-wainscot"):
        assert s[name].shape == (32, 16, 4)
        assert np.array_equal(s[name][:, 0], s[name][:, -1]), f"Wall repeat seam: {name}"
        assert (s[name][:, :, 3] == 255).all()
    assert np.array_equal(s["wall-plain"][:4], s["wall-wainscot"][:4])
    assert np.array_equal(s["wall-plain"][29:], s["wall-wainscot"][29:])
    assert np.array_equal(s["wall-end-left"][:, -1], s["wall-plain"][:, 0])
    assert np.array_equal(s["wall-end-right"][:, 0], s["wall-plain"][:, -1])
    assert np.array_equal(s["wall-end-right"], s["wall-end-left"][:, ::-1])
    side, outer, inner = (s[n] for n in ("wall-side-cap", "wall-outer-corner", "wall-inner-corner"))
    assert np.array_equal(side[0], side[-1])
    assert np.array_equal(outer[-1], side[0])
    assert np.array_equal(outer[:, -1], np.rot90(side, -1)[:, 0])
    assert np.array_equal(inner, outer[::-1, ::-1])
    assert not side[:, 4:, 3].any() and not outer[4:, 4:, 3].any()
    rim = np.zeros((32, 16), dtype=bool)
    rim[:3] = rim[-1] = True
    rim[:, :3] = rim[:, -3:] = True
    for kind in ("wood", "glass"):
        frames = [s[f"door-{kind}-{state}"] for state in ("closed", "half-open", "open")]
        assert all(frame.shape == (32, 16, 4) for frame in frames)
        assert all(np.array_equal(frame[rim], frames[0][rim]) for frame in frames[1:])
        assert len({frame.tobytes() for frame in frames}) == 3, "Duplicate door states"
        # Both permitted navy shades belong to the doorway. Measure the whole
        # aperture, excluding the common three-column jambs and outer header.
        dark = []
        for frame in frames:
            aperture = frame[4:30, 3:13, :3]
            mask = np.all(aperture == NAVY[:3], axis=2) | np.all(aperture == rgba("262b44")[:3], axis=2)
            dark.append(int(mask.sum()))
        assert dark[0] < dark[1] < dark[2], (kind, dark)
        animation = atlas["animations"][f"door-{kind}"]
        for i, key in enumerate(animation["states"]):
            entry = atlas["sprites"][key]
            assert entry["x"] == animation["x"] + i * 16 and entry["y"] == animation["y"]
            assert entry["anchor"] == [0, 32] and entry["blocksMovement"] == (i < 2)
    previous = json.loads((ROOT / "art/checks/floor-quality.json").read_text(encoding="utf-8"))
    assert previous["status"] == "passed"
    return {"status": "passed", "spriteCount": 29, "floorSprites": 14, "wallSprites": 7,
            "doorFrames": 6, "blankPlates": 2, "animations": 2,
            "wallAndDoorFrameSize": [16, 32], "capSize": [16, 16], "plateSize": [16, 8],
            "visiblePaletteColors": len(all_colors), "alphaLevels": [0, 255],
            "atlasBoundsAndOverlap": "passed", "wallRepeatsAndEnds": "passed",
            "capConnections": "passed", "fixedDoorFramesAndBaseline": "passed",
            "progressiveDoorOpening": "passed", "collisionStateMetadata": "passed",
            "floorChecks": "passed", "previewScale": 3}


def preview() -> None:
    atlas = json.loads((OUT / "atlas.json").read_text(encoding="utf-8"))
    _, pixels = read_sprites(atlas)
    s = {key: Image.fromarray(value) for key, value in pixels.items()}
    room = Image.new("RGBA", (256, 192))
    for y in range(9):
        for x in range(14):
            room.paste(s["wood-a" if (x + y) % 2 else "wood-b"], (16 + x * 16, 32 + y * 16))
    rug_keys = [["rug-top-left", *(["rug-top"] * 4), "rug-top-right"],
                *([["rug-left", *(["rug-center"] * 4), "rug-right"]] * 2),
                ["rug-bottom-left", *(["rug-bottom"] * 4), "rug-bottom-right"]]
    for y, row in enumerate(rug_keys):
        for x, name in enumerate(row):
            room.alpha_composite(s[name], (80 + x * 16, 96 + y * 16))
    for x in range(14):
        name = "wall-end-left" if x == 0 else "wall-end-right" if x == 13 else "wall-wainscot" if x >= 10 else "wall-plain"
        if x == 3:
            name = "door-wood-closed"
        if x == 10:
            name = "door-glass-open"
        room.alpha_composite(s[name], (16 + x * 16, 0))
    room.alpha_composite(s["wall-outer-corner"], (12, 0))
    room.alpha_composite(ImageOps.mirror(s["wall-outer-corner"]), (228, 0))
    for y in range(16, 176, 16):
        room.alpha_composite(s["wall-side-cap"], (12, y))
        room.alpha_composite(ImageOps.mirror(s["wall-side-cap"]), (228, y))
    canvas = Image.new("RGB", (1120, 1020), "#181425")
    draw = ImageDraw.Draw(canvas)
    def font(size: int, bold: bool = False):
        name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            return ImageFont.load_default(size=size)
    def text(x: int, y: int, value: str, size: int = 15, bold: bool = False, fill: str = "#c0cbdc"):
        draw.text((x, y), value, font=font(size, bold), fill=fill)
    def show(image: Image.Image, x: int, y: int):
        enlarged = image.resize((image.width * 3, image.height * 3), Image.Resampling.NEAREST)
        canvas.paste(enlarged, (x, y), enlarged)
    text(32, 22, "Pixel-Büro · Wände und Türen", 27, True, "#ffffff")
    text(32, 65, "29 Bausteine insgesamt · ENDESGA 32 · alle Grafiken exakt 3× ohne Glättung", 15)
    text(32, 100, "Montageprüfung mit den fertigen Böden", 16, True)
    show(room, 8, 132)
    text(832, 116, "Wandbausteine", 18, True, "#ffffff")
    for i, name in enumerate(("wall-plain", "wall-wainscot", "wall-end-left", "wall-end-right")):
        show(s[name], 832 + i * 60, 156)
    text(832, 268, "Putz / Holz / Abschlüsse", 13)
    for i, name in enumerate(("wall-side-cap", "wall-outer-corner", "wall-inner-corner")):
        show(s[name], 832 + i * 76, 322)
    text(832, 388, "Seite / Außenecke / Innenecke", 12)
    text(832, 448, "Wiederholte Segmente", 16, True)
    for i in range(4):
        show(s["wall-plain"], 832 + i * 48, 486)
        show(s["wall-wainscot"], 832 + i * 48, 598)
    for kind, left, title in (("wood", 32, "Holztür"), ("glass", 342, "Glastür")):
        text(left, 750, title, 19, True, "#ffffff")
        for i, (state, label) in enumerate((("closed", "zu"), ("half-open", "halb"), ("open", "offen"))):
            show(s[f"door-{kind}-{state}"], left + i * 88, 788)
            text(left + i * 88, 898, label, 13)
    text(656, 750, "Leere Schilder", 19, True, "#ffffff")
    show(s["plate-door"], 656, 802)
    show(s["plate-brass"], 744, 802)
    text(656, 850, "Beschriftung zeichnet der Code.", 13)
    text(32, 958, "Geprüft: Wandanschlüsse, unveränderliche Türrahmen, Öffnungszustände, Palette und Alpha.", 14)
    text(32, 986, "Die Tür wird im Code erst im vollständig offenen Zustand passierbar.", 13)
    canvas.save(ROOT / "art/checks/architecture-preview.png")


def animation_preview() -> None:
    atlas = json.loads((OUT / "atlas.json").read_text(encoding="utf-8"))
    _, sprites = read_sprites(atlas)
    frames = []
    palette = Image.new("P", (1, 1))
    palette.putpalette([v for rgb in floors.PALETTE for v in rgb] + [0] * (768 - 96))
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 16)
    except OSError:
        font = ImageFont.load_default(size=16)
    sequence = ("closed", "half-open", "open", "half-open")
    for state in sequence:
        frame = Image.new("RGB", (336, 220), "#181425")
        draw = ImageDraw.Draw(frame)
        for kind, left, label in (("wood", 56, "Holztür"), ("glass", 224, "Glastür")):
            draw.text((left - 8, 24), label, font=font, fill="#c0cbdc")
            sprite = Image.fromarray(sprites[f"door-{kind}-{state}"]).resize((48, 96), Image.Resampling.NEAREST)
            frame.paste(sprite, (left, 72), sprite)
        draw.text((56, 188), "16 × 32 px · Ansicht 3×", font=font, fill="#c0cbdc")
        frames.append(frame.quantize(palette=palette, dither=Image.Dither.NONE))
    path = ROOT / "art/checks/door-animation.gif"
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=[750, 150, 750, 150],
                   loop=0, disposal=2, optimize=False)
    gif = Image.open(path)
    assert gif.n_frames == 4
    for i, state in enumerate(sequence):
        gif.seek(i)
        rendered = gif.convert("RGB")
        for kind, left in (("wood", 56), ("glass", 224)):
            expected = Image.fromarray(sprites[f"door-{kind}-{state}"]).convert("RGB").resize((48, 96), Image.Resampling.NEAREST)
            assert np.array_equal(np.asarray(rendered.crop((left, 72, left + 48, 168))), np.asarray(expected))


def main() -> None:
    floors.main()
    config = json.loads((ROOT / "art/architecture-source.json").read_text(encoding="utf-8"))
    walls = make_walls(load_source(config, "walls"), config)
    doors = make_doors(load_source(config, "doors"), config)
    atlas = json.loads((OUT / "atlas.json").read_text(encoding="utf-8"))
    write_sheets(walls, doors, atlas)
    report = validate()
    preview()
    animation_preview()
    report["animationPreviewFrames"] = 4
    report["animationPreviewMatchesAtlas"] = True
    floors.save_json(ROOT / "art/checks/architecture-quality.json", report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
