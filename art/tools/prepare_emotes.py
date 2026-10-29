#!/usr/bin/env python3
"""Snap generated bubble artwork to native pixels and extend the office atlas."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

import prepare_animations as previous

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/assets/office"
room, furniture = previous.room, previous.furniture
rgba = room.rgba
NAVY, WHITE = rgba("181425"), rgba("ffffff")
POSITIONS = ("top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right")
EMOTES = ("alert", "question", "idea", "heart", "sweat", "done", "error", "music", "coffee", "waiting")


def load(item: dict) -> Image.Image:
    path = ROOT / item["file"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"], "Source changed; review crop coordinates"
    image = Image.open(path).convert("RGBA")
    assert list(image.size) == item["size"]
    return image


def shape(mask: np.ndarray) -> np.ndarray:
    pixels = np.zeros((*mask.shape, 4), dtype=np.uint8)
    pixels[mask] = WHITE
    return furniture.outlined(pixels)


def bodies(image: Image.Image, config: dict) -> dict:
    result = {}
    for name in ("speech", "thought"):
        pixels = room.raster(image, config["crops"][name], (12, 12), ["181425", "ffffff"])
        mask = pixels[:, :, 3] == 255
        # Mirror the source quadrant so all four nine-slice corners agree.
        quadrant = mask[:6, :6]
        mask = np.concatenate((quadrant, quadrant[:, ::-1]), axis=1)
        mask = np.concatenate((mask, mask[::-1]), axis=0)
        mask[2:10, 2:10] = True
        if name == "speech":
            # Straight middle edges; source's rounded corners are retained.
            mask[:, 4:8] = True
            mask[4:8, :] = True
        result[name] = shape(mask)
    result["speech-tail"] = room.raster(image, config["crops"]["tail"], (4, 4), ["181425", "ffffff"])
    # The white opening overwrites one bottom-border pixel row when attached.
    result["speech-tail"][0] = WHITE
    result["speech-tail"][2, 1:4] = (NAVY, WHITE, NAVY)
    puff = room.raster(image, config["crops"]["puff-large"], (4, 4), ["181425", "ffffff"])
    result["thought-puff-large"] = shape(puff[:, :, 3] == 255)
    result["thought-puff-small"] = np.full((2, 2, 4), NAVY, dtype=np.uint8)
    return result


def icons(image: Image.Image, config: dict, speech: np.ndarray) -> dict:
    result = {}
    for name in EMOTES:
        item = config["symbols"][name]
        width, height = item["size"]
        symbol = room.raster(image, item["box"], (width, height), item["palette"])
        if "retouchRows" in item:
            # Native-pixel cleanup of details that collapse when reduced:
            # bulb outline/rays, diagonal cross, hourglass frame and sand.
            colors = {".": WHITE, "n": NAVY, "y": rgba("fee761"), "g": rgba("5a6988"),
                      "r": rgba("e43b44"), "d": rgba("a22633")}
            symbol = np.array([[colors[c] for c in row] for row in item["retouchRows"]], dtype=np.uint8)
        # Every emote shares the generated rounded speech shell, normalized
        # to eleven body rows plus one short central tail row.
        frame = np.zeros((12, 12, 4), dtype=np.uint8)
        frame[:11] = speech[:11]
        frame[10] = speech[11]
        frame[10, 5:7] = WHITE
        frame[11, 5:7] = NAVY
        x, y = (12 - width) // 2, 1 + (8 - height) // 2
        frame[y:y + height, x:x + width] = symbol
        result[name] = frame
    return result


def animations(image: Image.Image, config: dict) -> tuple[list, list]:
    sleeping = []
    for item in config["sleep"]:
        w, h = item["size"]
        pixels = room.raster(image, item["box"], (w, h), ["181425"])
        frame = np.zeros((12, 12, 4), dtype=np.uint8)
        x, y = item["offset"]
        frame[y:y + h, x:x + w] = pixels
        sleeping.append(frame)
    gears = []
    base = image.crop(tuple(config["gearBase"]))
    for angle in (0, 11.25, 22.5, 33.75):
        rotated = base.rotate(-angle, Image.Resampling.NEAREST, center=(base.width / 2, base.height / 2))
        pixels = room.raster(rotated, [0, 0, base.width, base.height], (8, 8), ["181425", "c0cbdc", "8b9bb4", "5a6988"])
        pixels = furniture.outlined(pixels)
        pixels[3:5, 3:5] = NAVY
        material = (pixels[:, :, 3] == 255) & ~np.all(pixels == NAVY, axis=2)
        yy, xx = np.indices((8, 8))
        for mask, shade in (((xx + yy) <= 5, "c0cbdc"), (((xx + yy) > 5) & ((xx + yy) <= 8), "8b9bb4"), ((xx + yy) > 8, "5a6988")):
            pixels[material & mask] = rgba(shade)
        gears.append(pixels)
    return sleeping, gears


def write_atlas(atlas: dict, shells: dict, emotes: dict, sleep: list, gears: list) -> dict:
    sheet = np.zeros((64, 64, 4), dtype=np.uint8)
    image = "fx/bubbles.png"
    def add(key, pixels, x, y, anchor=None):
        h, w = pixels.shape[:2]
        sheet[y:y + h, x:x + w] = pixels
        atlas["sprites"][key] = {"image": image, "x": x, "y": y, "width": w, "height": h,
                                  "frames": 1, "anchor": anchor or [w // 2, h], "layer": "above-character"}
    for name, x in (("speech", 0), ("thought", 16)):
        pieces = {}
        for i, position in enumerate(POSITIONS):
            r, c = divmod(i, 3)
            key = f"bubble-{name}-{position}"
            add(key, shells[name][r * 4:r * 4 + 4, c * 4:c * 4 + 4], x + c * 4, r * 4)
            pieces[position] = key
        atlas.setdefault("nineSlice", {})[f"bubble-{name}"] = {
            "pieceSize": [4, 4], "minSize": [12, 12], "sizeMultiple": 1 if name == "speech" else 4,
            "mode": "repeat", "pieces": pieces, "contentPadding": [3, 3, 3, 3]}
    add("bubble-speech-tail", shells["speech-tail"], 32, 0, [2, 4])
    add("bubble-thought-puff-large", shells["thought-puff-large"], 40, 0, [2, 4])
    add("bubble-thought-puff-small", shells["thought-puff-small"], 48, 0, [1, 2])
    for i, name in enumerate(EMOTES):
        r, c = divmod(i, 5)
        add("emote-" + name, emotes[name], c * 12, 16 + r * 12, [6, 12])
    for frames, key, y, size, duration in ((sleep, "sleep-z", 44, 12, 320), (gears, "working-gear", 56, 8, 140)):
        states = []
        for i, pixels in enumerate(frames):
            state = key + "-" + str(i)
            add(state, pixels, i * size, y, [size // 2, size])
            states.append(state)
        atlas["animations"][key] = {"image": image, "x": 0, "y": y, "width": size, "height": size,
                                     "frames": len(frames), "frameDurationMs": duration, "loop": True,
                                     "states": states, "anchor": [size // 2, size], "layer": "above-character"}
    atlas["meta"]["images"][image] = {"width": 64, "height": 64}
    atlas["overhead"] = {
        "coordinateSpace": "logical-pixels", "headOffsetFromFeet": [0, -34],
        "speech": {"nineSlice": "bubble-speech", "tail": "bubble-speech-tail", "tailOverlap": 1,
                   "tailHorizontalRange": [3, "width-7"], "textDrawnByCode": True},
        "thought": {"nineSlice": "bubble-thought", "puffs": [
            {"sprite": "bubble-thought-puff-large", "offsetFromBodyBottomCenter": [-2, 1]},
            {"sprite": "bubble-thought-puff-small", "offsetFromBodyBottomCenter": [0, 6]}],
                    "textDrawnByCode": True},
        "emotes": {name: "emote-" + name for name in EMOTES},
        "sleep": "sleep-z", "working": "working-gear", "opacityAppliedByCode": True}
    (OUT / "fx").mkdir(parents=True, exist_ok=True)
    Image.fromarray(sheet).save(OUT / image)
    room.floors.save_json(OUT / "atlas.json", atlas)
    return atlas


def assemble(pieces: dict, width: int, height: int) -> np.ndarray:
    """Repeat edge/center tiles at native scale; corners always stay 4x4."""
    assert width >= 12 and height >= 12
    output = np.zeros((height, width, 4), dtype=np.uint8)
    for y in range(height):
        r = 0 if y < 4 else 2 if y >= height - 4 else 1
        sy = y if r == 0 else y - height + 4 if r == 2 else (y - 4) % 4
        for x in range(width):
            c = 0 if x < 4 else 2 if x >= width - 4 else 1
            sx = x if c == 0 else x - width + 4 if c == 2 else (x - 4) % 4
            output[y, x] = pieces[POSITIONS[r * 3 + c]][sy, sx]
    return output


def validate(atlas: dict, old_atlas: dict) -> dict:
    images, sprites = room.read_sprites(atlas)
    assert len(sprites) == 156 and len(atlas["animations"]) == 25
    for key, entry in old_atlas["sprites"].items():
        assert atlas["sprites"][key] == entry, key
    for key, entry in old_atlas["animations"].items():
        assert atlas["animations"][key] == entry, key
    pixels = images["fx/bubbles.png"]
    assert set(np.unique(pixels[:, :, 3])) == {0, 255}
    assert {tuple(c) for c in pixels[pixels[:, :, 3] == 255, :3].tolist()} <= set(room.floors.PALETTE)
    coverage = np.zeros((64, 64), dtype=np.uint8)
    for key, entry in atlas["sprites"].items():
        if entry["image"] != "fx/bubbles.png":
            continue
        x, y, w, h = (entry[k] for k in ("x", "y", "width", "height"))
        assert 0 <= x <= 64 - w and 0 <= y <= 64 - h
        coverage[y:y + h, x:x + w] += 1
        assert sprites[key][:, :, 3].any(), key
    assert coverage.max() == 1 and not pixels[coverage == 0, 3].any()
    for name in ("speech", "thought"):
        spec = atlas["nineSlice"]["bubble-" + name]
        pieces = {position: sprites[key] for position, key in spec["pieces"].items()}
        for w, h in ((12, 12), (16, 16), (24, 16), (48, 24), (80, 32)):
            body = assemble(pieces, w, h)
            assert np.all(body[3:h - 3, 3:w - 3] == WHITE), (name, w, h, "interior seam")
            # Every transparent pixel must be reachable from the outside,
            # so no nine-slice join leaves a pinhole inside the white body.
            empty = np.pad(body[:, :, 3] == 0, 1, constant_values=True)
            seen = np.zeros_like(empty)
            stack = [(0, 0)]; seen[0, 0] = True
            while stack:
                y, x = stack.pop()
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < empty.shape[0] and 0 <= xx < empty.shape[1] and empty[yy, xx] and not seen[yy, xx]:
                        seen[yy, xx] = True; stack.append((yy, xx))
            assert np.array_equal(seen, empty), (name, w, h, "interior alpha hole")
    assert len({sprites["emote-" + name].tobytes() for name in EMOTES}) == 10
    for name, n in (("sleep-z", 3), ("working-gear", 4)):
        animation = atlas["animations"][name]
        frames = [sprites[k] for k in animation["states"]]
        assert len({p.tobytes() for p in frames}) == n, (name, "duplicate frame")
        for i, key in enumerate(animation["states"]):
            entry = atlas["sprites"][key]
            assert entry["x"] == animation["x"] + i * animation["width"]
    sleep = [sprites[f"sleep-z-{i}"] for i in range(3)]
    bboxes = [Image.fromarray(frame).getbbox() for frame in sleep]
    assert all(bboxes[i + 1][1] < bboxes[i][1] for i in range(2)), "Z must rise"
    assert all(bboxes[i + 1][2] - bboxes[i + 1][0] > bboxes[i][2] - bboxes[i][0] for i in range(2)), "Z must grow"
    gears = [sprites[f"working-gear-{i}"] for i in range(4)]
    assert len({p[:, :, 3].tobytes() for p in gears}) == 4, "Gear must turn rather than flicker"
    assert all(np.all(p[3:5, 3:5] == NAVY) for p in gears), "Gear center must remain fixed"
    return {"status": "passed", "totalSprites": 156, "totalAnimations": 25, "newSprites": 38,
            "newAnimations": 2, "sheetSize": [64, 64], "nineSlicePieceSize": [4, 4],
            "emoteSize": [12, 12], "sleepSize": [12, 12], "gearSize": [8, 8],
            "alphaLevels": [0, 255], "palette": "ENDESGA 32", "atlasBoundsAndOverlap": "passed",
            "nineSliceWhiteInteriorAndNoHoles": "passed", "tenDistinctEmotes": "passed",
            "sleepRisesAndGrows": "passed", "fourDistinctGearSilhouettes": "passed", "gearCenterFixed": "passed",
            "previousSpriteAndAnimationEntries": "unchanged", "previewScale": 3}


def main() -> None:
    previous.main()
    atlas = json.loads((OUT / "atlas.json").read_text(encoding="utf-8"))
    old_atlas = json.loads(json.dumps(atlas))
    config = json.loads((ROOT / "art/emote-source.json").read_text(encoding="utf-8"))
    shells = bodies(load(config["bubble-shells"]), config["bubble-shells"])
    emotes = icons(load(config["emote-icons"]), config["emote-icons"], shells["speech"])
    sleep, gears = animations(load(config["sleep-gear"]), config["sleep-gear"])
    atlas = write_atlas(atlas, shells, emotes, sleep, gears)
    report = validate(atlas, old_atlas)
    from emote_previews import build
    report.update(build(atlas))
    room.floors.save_json(ROOT / "art/checks/emotes-quality.json", report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
