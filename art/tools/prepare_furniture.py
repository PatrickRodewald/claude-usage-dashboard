#!/usr/bin/env python3
"""Build modular workplace and kitchen sprites plus the complete office atlas."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

import prepare_room as room

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/assets/office"
NAVY = room.NAVY
rgba = room.rgba
WOOD = ["181425", "e4a672", "b86f50", "733e39"]
METAL = ["181425", "5a6988", "8b9bb4", "c0cbdc"]
CHAIR = ["181425", "262b44", "3a4466", "5a6988", "8b9bb4", "c0cbdc"]
LAPTOP = [*METAL, "0099db", "2ce8f5"]
CUP = ["181425", "ffffff", "c0cbdc", "ead4aa", "733e39"]
MACHINE = ["181425", "3a4466", "5a6988", "8b9bb4", "ffffff", "c0cbdc", "ead4aa", "733e39", "63c74d", "fee761"]
COOLER = [*METAL, "ffffff", "124e89", "0099db", "2ce8f5", "e43b44"]


def outlined(pixels: np.ndarray) -> np.ndarray:
    """Close the one-pixel silhouette without altering the source alpha mask."""
    output = pixels.copy()
    mask = pixels[:, :, 3] == 255
    padded = np.pad(mask, 1)
    inside = padded[1:-1, 1:-1]
    edge = inside & ~(padded[:-2, 1:-1] & padded[2:, 1:-1] & padded[1:-1, :-2] & padded[1:-1, 2:])
    output[edge] = NAVY
    return output


def source(config: dict, key: str) -> Image.Image:
    item = config[key]
    file = ROOT / item["file"]
    if hashlib.sha256(file.read_bytes()).hexdigest() != item["sha256"]:
        raise ValueError(f"Unexpected {key} source; review crop coordinates first")
    image = Image.open(file).convert("RGBA")
    if list(image.size) != item["size"]:
        raise ValueError(f"Unexpected {key} dimensions")
    return image


def sample(image: Image.Image, box: list[int], size: tuple[int, int], palette: list[str],
           content: tuple[int, int] | None = None) -> np.ndarray:
    width, height = size
    cw, ch = content or size
    normalized = outlined(room.raster(image, box, (cw, ch), palette))
    output = np.zeros((height, width, 4), dtype=np.uint8)
    output[height - ch:, (width - cw) // 2:(width - cw) // 2 + cw] = normalized
    return output


def workplace(image: Image.Image, config: dict) -> dict[str, np.ndarray]:
    crops = config["workplace"]["crops"]
    result = {
        "desk-large": sample(image, crops["desk-large"], (48, 24), WOOD),
        "desk-small": sample(image, crops["desk-small"], (32, 24), WOOD),
        "chair-back": sample(image, crops["chair-back"], (16, 24), CHAIR),
        "chair-front": sample(image, crops["chair-front"], (16, 24), CHAIR),
        "chair-right": sample(image, crops["chair-right"], (16, 24), CHAIR),
        "laptop-closed": sample(image, crops["laptop-closed"], (16, 16), LAPTOP, (16, 10)),
        "laptop-back-open": sample(image, crops["laptop-back-open"], (16, 16), LAPTOP, (16, 12)),
        "laptop-front-open": sample(image, crops["laptop-front-open"], (16, 16), LAPTOP),
    }
    # Remove the generic badge from the generated lids; keep both lids blank.
    result["laptop-closed"][7:12, 2:14] = rgba("8b9bb4")
    result["laptop-back-open"][5:14, 2:14] = rgba("8b9bb4")
    result["laptop-back-open"][5, 2:14] = rgba("2ce8f5")
    result["laptop-front-open"][2:9, 3:13] = rgba("2ce8f5")
    lamp = sample(image, crops["lamp-off"], (16, 16), ["181425", "262b44", "3a4466", "5a6988", "c0cbdc"])
    yy, xx = np.indices((16, 16))
    bulb = np.all(lamp[:, :, :3] == rgba("c0cbdc")[:3], axis=2) & (xx >= 7) & (yy >= 3) & (yy <= 12)
    if not bulb.any():
        raise ValueError("Lamp bulb was lost while reducing the image; review its crop")
    on = lamp.copy()
    on[bulb] = rgba("fee761")
    result.update({"lamp-off": lamp, "lamp-on": on})
    mug = sample(image, crops["mug-body"], (8, 16), CUP, (8, 8))
    result["mug-idle"] = mug
    steam = [((3, 7), (4, 6), (4, 5)),
             ((4, 5), (3, 4), (3, 3), (4, 2)),
             ((4, 2), (5, 1), (4, 0))]
    for i, points in enumerate(steam, 1):
        frame = mug.copy()
        for x, y in points:
            frame[y, x] = rgba("ffffff")
        result[f"mug-steam-{i}"] = frame
    return result


def kitchen(image: Image.Image, config: dict) -> dict[str, np.ndarray]:
    crops = config["kitchen"]["crops"]
    result = {"kitchen-counter": sample(image, crops["counter"], (48, 24), [*WOOD, *METAL[1:]])}
    machine = sample(image, crops["espresso"][0], (16, 24), MACHINE)
    # Keep the generated housing and cup fixed. Only the status, stream,
    # steam and coffee surface change within the following small regions.
    for state in ("idle", "drip", "steam", "ready"):
        frame = machine.copy()
        frame[8, 5] = rgba("63c74d" if state in ("idle", "ready") else "fee761")
        frame[17, 6:10] = rgba("c0cbdc" if state == "idle" else "733e39")
        if state == "drip":
            frame[13:17, 8] = rgba("733e39")
        if state == "steam":
            for x, y in ((8, 15), (9, 14), (9, 13), (8, 12)):
                frame[y, x] = rgba("ffffff")
        result[f"espresso-{state}"] = frame
    cooler = sample(image, crops["cooler"][0], (16, 32), COOLER)
    # Remove the source bubble before placing an aligned 2x2 bubble per frame.
    area = cooler[3:13, 5:10]
    white = np.all(area[:, :, :3] == rgba("ffffff")[:3], axis=2)
    area[white] = rgba("0099db")
    for i, y in enumerate((10, 7, 4), 1):
        frame = cooler.copy()
        frame[y:y + 2, 6:8] = rgba("ffffff")
        result[f"cooler-bubble-{i}"] = frame
    result["fridge"] = sample(image, crops["fridge"], (16, 32), [*METAL, "ffffff"])
    result["tray-mugs"] = sample(image, crops["tray-mugs"], (16, 16), [*CUP, *WOOD[1:]], (16, 8))
    return result


def write_assets(work: dict, kit: dict) -> dict:
    atlas = json.loads((OUT / "atlas.json").read_text(encoding="utf-8"))
    (OUT / "furniture").mkdir(exist_ok=True)
    sheets = {"furniture/workplace.png": Image.new("RGBA", (80, 96)),
              "furniture/kitchen.png": Image.new("RGBA", (64, 96))}
    placements = {
        "desk-large": (0, 0), "desk-small": (48, 0),
        "chair-back": (0, 32), "chair-front": (16, 32), "chair-right": (32, 32),
        "laptop-closed": (0, 64), "laptop-back-open": (16, 64), "laptop-front-open": (32, 64),
        "lamp-off": (48, 64), "lamp-on": (64, 64),
        "mug-idle": (0, 80), "mug-steam-1": (8, 80), "mug-steam-2": (16, 80), "mug-steam-3": (24, 80),
        "kitchen-counter": (0, 0), "espresso-idle": (0, 32), "espresso-drip": (16, 32),
        "espresso-steam": (32, 32), "espresso-ready": (48, 32),
        "cooler-bubble-1": (0, 64), "cooler-bubble-2": (16, 64), "cooler-bubble-3": (32, 64),
        "fridge": (48, 64), "tray-mugs": (48, 0)}
    for collection, file in ((work, "furniture/workplace.png"), (kit, "furniture/kitchen.png")):
        for name, pixels in collection.items():
            image = Image.fromarray(pixels)
            x, y = placements[name]
            sheets[file].paste(image, (x, y))
            entry = {"image": file, "x": x, "y": y, "width": image.width, "height": image.height,
                     "frames": 1, "anchor": [0, image.height]}
            if name in ("desk-large", "desk-small", "kitchen-counter", "fridge") or name.startswith(("chair-", "cooler-")):
                entry["footprintTiles"] = [3 if name in ("desk-large", "kitchen-counter") else 2 if name == "desk-small" else 1, 1]
            atlas["sprites"][name] = entry
    for file, sheet in sheets.items():
        sheet.save(OUT / file)
        atlas["meta"]["images"][file] = {"width": sheet.width, "height": sheet.height}
    for name, file, x, y, width, height, frames, duration, loop, states in (
        ("mug-steam", "furniture/workplace.png", 8, 80, 8, 16, 3, 160, True, [f"mug-steam-{i}" for i in range(1, 4)]),
        ("espresso", "furniture/kitchen.png", 0, 32, 16, 24, 4, 250, False, [f"espresso-{s}" for s in ("idle", "drip", "steam", "ready")]),
        ("cooler-bubble", "furniture/kitchen.png", 0, 64, 16, 32, 3, 220, True, [f"cooler-bubble-{i}" for i in range(1, 4)])):
        atlas["animations"][name] = {"image": file, "x": x, "y": y, "width": width, "height": height,
                                     "frames": frames, "frameDurationMs": duration, "loop": loop, "states": states}
    atlas["stateGroups"] = {"desk-lamp": ["lamp-off", "lamp-on"],
                             "laptop": ["laptop-closed", "laptop-back-open", "laptop-front-open"]}
    atlas["mountPoints"] = {
        "desk-large": {"laptop": [16, -4], "lamp": [1, -5], "mug": [36, -2]},
        "desk-small": {"laptop": [8, -4], "mug": [24, -2]},
        "kitchen-counter": {"espresso": [0, -16], "tray": [28, -8]}}
    for name, bottom in (("desk-large", 14), ("desk-small", 14), ("kitchen-counter", 10)):
        atlas["sprites"][name]["surfaceBottomY"] = bottom
    room.floors.save_json(OUT / "atlas.json", atlas)
    return atlas


def validate() -> dict:
    atlas = json.loads((OUT / "atlas.json").read_text(encoding="utf-8"))
    images, s = room.read_sprites(atlas)
    assert len(s) == 53 and len(atlas["animations"]) == 5
    palette = set(room.floors.PALETTE)
    for name, pixels in images.items():
        dims = atlas["meta"]["images"][name]
        assert pixels.shape[:2] == (dims["height"], dims["width"])
        assert set(np.unique(pixels[:, :, 3])) <= {0, 255}
        assert {tuple(c) for c in pixels[pixels[:, :, 3] == 255, :3].tolist()} <= palette
        coverage = np.zeros(pixels.shape[:2], dtype=np.uint8)
        for key, entry in atlas["sprites"].items():
            if entry["image"] != name:
                continue
            x, y, w, h = (entry[k] for k in ("x", "y", "width", "height"))
            assert x % 8 == y % 8 == w % 8 == h % 8 == 0
            assert 0 <= x <= pixels.shape[1] - w and 0 <= y <= pixels.shape[0] - h
            assert s[key].shape == (h, w, 4) and s[key][:, :, 3].any()
            coverage[y:y + h, x:x + w] += 1
        assert coverage.max() == 1
        assert not pixels[coverage == 0, 3].any()
    for key, shape in (("desk-large", (24, 48, 4)), ("desk-small", (24, 32, 4)),
                       ("chair-front", (24, 16, 4)), ("kitchen-counter", (24, 48, 4)),
                       ("fridge", (32, 16, 4)), ("tray-mugs", (16, 16, 4))):
        assert s[key].shape == shape
    assert np.array_equal(s["lamp-off"][:, :, 3], s["lamp-on"][:, :, 3])
    lamp_delta = np.any(s["lamp-off"] != s["lamp-on"], axis=2)
    yy, xx = np.where(lamp_delta)
    assert len(yy) > 0 and (xx >= 7).all() and (yy >= 3).all() and (yy <= 12).all()
    steam_centers = []
    for i in range(1, 4):
        assert np.array_equal(s[f"mug-steam-{i}"][8:], s["mug-idle"][8:])
        y, x = np.where(s[f"mug-steam-{i}"][:8, :, 3] == 255)
        assert len(y) >= 3
        steam_centers.append(float(y.mean()))
    assert steam_centers[0] > steam_centers[1] > steam_centers[2]
    dynamic = np.zeros((24, 16), dtype=bool)
    dynamic[7:10, 4:7] = True
    dynamic[12:18, 6:11] = True
    machine_frames = [s[f"espresso-{state}"] for state in ("idle", "drip", "steam", "ready")]
    assert len({frame.tobytes() for frame in machine_frames}) == 4
    assert all(np.array_equal(frame[~dynamic], machine_frames[0][~dynamic]) for frame in machine_frames[1:])
    static = np.ones((32, 16), dtype=bool)
    static[3:13, 5:10] = False
    coolers = [s[f"cooler-bubble-{i}"] for i in range(1, 4)]
    assert all(np.array_equal(frame[static], coolers[0][static]) for frame in coolers[1:])
    assert all(np.array_equal(frame[:, :, 3], coolers[0][:, :, 3]) for frame in coolers[1:])
    bubble_centers = []
    for frame in coolers:
        white = np.all(frame[3:13, 5:10, :3] == rgba("ffffff")[:3], axis=2)
        y, x = np.where(white)
        assert len(y) == 4
        bubble_centers.append(float(y.mean()))
    assert bubble_centers[0] > bubble_centers[1] > bubble_centers[2]
    for animation in atlas["animations"].values():
        for i, state in enumerate(animation["states"]):
            entry = atlas["sprites"][state]
            assert entry["image"] == animation["image"] and entry["x"] == animation["x"] + i * animation["width"]
            assert entry["y"] == animation["y"] and entry["width"] == animation["width"] and entry["height"] == animation["height"]
    for surface, points in atlas["mountPoints"].items():
        width = atlas["sprites"][surface]["width"]
        for key, pos in points.items():
            prop_width = 8 if key == "mug" else 16
            assert 0 <= pos[0] and pos[0] + prop_width <= width
            prop_height = 24 if key == "espresso" else 16
            assert pos[1] + prop_height <= atlas["sprites"][surface]["surfaceBottomY"]
    assert json.loads((ROOT / "art/checks/architecture-quality.json").read_text())["status"] == "passed"
    return {"status": "passed", "totalSprites": 53, "workplaceSprites": 14, "kitchenSprites": 10,
            "totalAnimations": 5, "palette": "ENDESGA 32", "alphaLevels": [0, 255],
            "atlasBoundsAndOverlap": "passed", "dimensions": "passed", "mountPointWidths": "passed",
            "fixedMugBodyAndRisingSteam": "passed", "fixedMachineBody": "passed",
            "fixedCoolerAndRisingBubble": "passed", "fixedLampBody": "passed", "previewScale": 3}


def font(size: int, bold: bool = False):
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default(size=size)


def previews(atlas: dict) -> None:
    _, pixels = room.read_sprites(atlas)
    s = {key: Image.fromarray(value) for key, value in pixels.items()}
    scene = Image.new("RGBA", (320, 240))
    def put(name: str, x: int, y: int):
        scene.alpha_composite(s[name], (x, y))
    for y in range(12):
        for x in range(18):
            put("wood-a" if (x + y) % 2 else "wood-b", 16 + x * 16, 32 + y * 16)
    for y in range(4):
        for x in range(14):
            row = "top" if y == 0 else "bottom" if y == 3 else ""
            col = "left" if x == 0 else "right" if x == 13 else ""
            name = "rug-" + (row + "-" + col if row and col else row or col or "center")
            put(name, 48 + x * 16, 144 + y * 16)
    for x in range(18):
        name = "wall-end-left" if x == 0 else "wall-end-right" if x == 17 else "wall-plain"
        if x == 2:
            name = "door-wood-closed"
        put(name, 16 + x * 16, 0)
    scene.alpha_composite(s["wall-outer-corner"], (12, 0))
    scene.alpha_composite(ImageOps.mirror(s["wall-outer-corner"]), (292, 0))
    for y in range(16, 224, 16):
        put("wall-side-cap", 12, y)
        scene.alpha_composite(ImageOps.mirror(s["wall-side-cap"]), (292, y))
    put("kitchen-counter", 32, 56)
    put("espresso-ready", 32, 40)
    put("tray-mugs", 60, 48)
    put("fridge", 88, 48)
    put("cooler-bubble-2", 112, 48)
    def desk(name: str, x: int, y: int, lamp: bool):
        width = s[name].width
        put("chair-front", x + (width - 16) // 2, y - 12)
        put(name, x, y)
        points = atlas["mountPoints"][name]
        for prop, sprite in (("laptop", "laptop-back-open"), ("mug", "mug-steam-2")):
            dx, dy = points[prop]
            put(sprite, x + dx, y + dy)
        if lamp:
            dx, dy = points["lamp"]
            put("lamp-on", x + dx, y + dy)
    desk("desk-large", 160, 88, True)
    desk("desk-large", 224, 88, True)
    for x in (64, 144, 224):
        desk("desk-small", x, 168, False)
    scene.save(ROOT / "art/checks/room-native.png")
    canvas = Image.new("RGB", (1120, 1320), "#181425")
    draw = ImageDraw.Draw(canvas)
    def text(x, y, value, size=15, bold=False, fill="#c0cbdc"):
        draw.text((x, y), value, font=font(size, bold), fill=fill)
    def show(image, x, y):
        enlarged = image.resize((image.width * 3, image.height * 3), Image.Resampling.NEAREST)
        canvas.paste(enlarged, (x, y), enlarged)
    text(32, 24, "Pixel-Büro · Arbeitsplätze und Kaffeeecke", 26, True, "#ffffff")
    text(32, 66, "53 Bausteine insgesamt · modulare Möbel · Ansicht exakt 3× ohne Glättung", 15)
    show(scene, 32, 110)
    text(32, 858, "Arbeitsplatz-Bausteine", 20, True, "#ffffff")
    for name, x, y in (("desk-large", 32, 910), ("desk-small", 200, 910),
                       ("chair-back", 350, 910), ("chair-front", 422, 910), ("chair-right", 494, 910),
                       ("laptop-closed", 620, 934), ("laptop-back-open", 692, 934), ("laptop-front-open", 764, 934),
                       ("lamp-off", 888, 934), ("lamp-on", 960, 934)):
        show(s[name], x, y)
    for x, label in ((32, "Tische"), (350, "Stuhlansichten"), (620, "Laptopansichten"), (888, "Lampe aus / an")):
        text(x, 994, label, 13)
    text(32, 1040, "Kaffeeecke und Animationen", 20, True, "#ffffff")
    show(s["kitchen-counter"], 32, 1104)
    for i, state in enumerate(("idle", "drip", "steam", "ready")):
        show(s[f"espresso-{state}"], 220 + i * 60, 1104)
    for i in range(3):
        show(s[f"cooler-bubble-{i + 1}"], 500 + i * 60, 1080)
    show(s["fridge"], 704, 1080)
    show(s["tray-mugs"], 800, 1128)
    for i, state in enumerate(("idle", "steam-1", "steam-2", "steam-3")):
        show(s[f"mug-{state}"], 900 + i * 32, 1128)
    for x, label in ((32, "Küchentheke"), (220, "Maschinenzustände"), (500, "Blase steigt auf"),
                     (704, "Kühlschrank"), (800, "Tablett"), (900, "Tasse und Dampf")):
        text(x, 1190, label, 12)
    text(32, 1252, "Geprüft: feste Animationskörper, bewegte Details, Maße, Palette, Alpha und Atlaspositionen.", 14)
    text(32, 1284, "Beschriftungen stammen aus dem Code. Die Spielgrafiken bleiben textfrei.", 13)
    canvas.save(ROOT / "art/checks/furniture-preview.png")
    animation_preview(s)


def animation_preview(s: dict[str, Image.Image]) -> None:
    palette = Image.new("P", (1, 1))
    palette.putpalette([v for rgb in room.floors.PALETTE for v in rgb] + [0] * 672)
    frames, expected_states = [], []
    for i in range(12):
        state = "idle" if i < 2 else "drip" if i < 5 else "steam" if i < 8 else "ready"
        sprites = [(f"mug-steam-{1 + i % 3}", 64, 128), (f"espresso-{state}", 184, 104),
                   (f"cooler-bubble-{1 + i % 3}", 304, 80), ("lamp-on" if i % 8 >= 4 else "lamp-off", 424, 128)]
        frame = Image.new("RGB", (560, 230), "#181425")
        draw = ImageDraw.Draw(frame)
        for x, title in ((52, "Tasse"), (170, "Kaffee"), (290, "Wasser"), (410, "Lampe")):
            draw.text((x, 28), title, font=font(16), fill="#c0cbdc")
        for name, x, y in sprites:
            image = s[name].resize((s[name].width * 3, s[name].height * 3), Image.Resampling.NEAREST)
            frame.paste(image, (x, y), image)
        draw.text((52, 200), "Ansicht 3× · unveränderte Körper und Auflagepunkte", font=font(13), fill="#c0cbdc")
        expected_states.append(sprites)
        frames.append(frame.quantize(palette=palette, dither=Image.Dither.NONE))
    path = ROOT / "art/checks/furniture-animation.gif"
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=160, loop=0, disposal=2, optimize=False)
    gif = Image.open(path)
    assert gif.n_frames == 12
    for i, sprites in enumerate(expected_states):
        gif.seek(i)
        actual = gif.convert("RGB")
        for name, x, y in sprites:
            sprite = s[name].resize((s[name].width * 3, s[name].height * 3), Image.Resampling.NEAREST)
            expected = Image.new("RGB", sprite.size, "#181425")
            expected.paste(sprite, mask=sprite)
            assert np.array_equal(np.asarray(actual.crop((x, y, x + sprite.width, y + sprite.height))), np.asarray(expected))


def main() -> None:
    room.main()
    config = json.loads((ROOT / "art/furniture-source.json").read_text(encoding="utf-8"))
    work = workplace(source(config, "workplace"), config)
    kit = kitchen(source(config, "kitchen"), config)
    atlas = write_assets(work, kit)
    report = validate()
    previews(atlas)
    report["animationPreviewFrames"] = 12
    report["animationPreviewMatchesAtlas"] = True
    room.floors.save_json(ROOT / "art/checks/furniture-quality.json", report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
