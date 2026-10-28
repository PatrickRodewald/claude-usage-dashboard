#!/usr/bin/env python3
"""Normalize the generated walking/work poses into consistent game animations."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import prepare_characters as chars

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/assets/office"
room, furniture = chars.room, chars.furniture
rgba, NAVY = chars.rgba, room.NAVY
VIEWS = ("front", "back", "right")
TASKS = ("type", "read", "write", "think")
SKIN = {"look-01": ("733e39", "b86f50", "c28569"),
        "look-02": ("ead4aa", "e8b796", "c28569")}
GREY = ("181425", "262b44", "3a4466", "5a6988", "8b9bb4")


def colors_mask(pixels: np.ndarray, colors) -> np.ndarray:
    return np.logical_or.reduce([np.all(pixels == rgba(h), axis=2) for h in colors])


def overlay(base: np.ndarray, top: np.ndarray) -> np.ndarray:
    result = base.copy()
    mask = top[:, :, 3] == 255
    result[mask] = top[mask]
    return result


def dilate(mask: np.ndarray) -> np.ndarray:
    p = np.pad(mask, 1)
    return p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]


def clean_keys(pixels: np.ndarray) -> np.ndarray:
    result = pixels.copy()
    allowed = np.zeros((32, 16), dtype=bool)
    allowed[12:21] = True
    for old, new in zip(chars.KEYS, ("c0cbdc", "5a6988", "3a4466")):
        result[np.all(result == old, axis=2) & ~allowed] = rgba(new)
    mask = chars.key_mask(result)
    yy, xx = np.where(mask)
    if len(yy) < 5:
        raise ValueError("Clothing area lost in an animation frame")
    for i, key in enumerate(chars.KEYS):
        if np.all(result == key, axis=2).any():
            continue
        rank = yy * 16 + xx if i == 0 else -(yy * 16 + xx) if i == 2 else (yy - 16) ** 2 + (xx - 8) ** 2
        for j in np.argsort(rank):
            if np.all(result == result[yy[j], xx[j]], axis=2).sum() > 1:
                result[yy[j], xx[j]] = key
                break
    return result


def load_source(item: dict) -> Image.Image:
    path = ROOT / item["file"]
    if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
        raise ValueError("Animation source changed; review crop coordinates first")
    image = Image.open(path).convert("RGBA")
    if list(image.size) != item["size"]:
        raise ValueError("Unexpected animation source size")
    return image


def raw_pose(image: Image.Image, item: dict, look: str, scale: float, split: tuple[int, int]) -> np.ndarray:
    x0, y0, x1, y1 = item["box"]
    start, end = split
    width = min(16, max(1, round((x1 - x0) * scale)))
    crop = np.asarray(image.crop((x0, y0 + start, x1, y0 + end))).astype(np.float32)
    blue = (crop[:, :, 1] > crop[:, :, 0] + 20) & (crop[:, :, 2] > crop[:, :, 0] + 30) & (crop[:, :, 3] > 192)
    _, bx = np.where(blue)
    center = float(bx.mean()) if len(bx) else (x1 - x0) / 2
    left = max(0, min(16 - width, round(8 - center * width / (x1 - x0))))
    result = np.zeros((32, 16, 4), dtype=np.uint8)
    palette = list(dict.fromkeys([*chars.PALETTES[look], "8b9bb4"]))
    for sy0, sy1, ty, h in ((y0, y0 + start, 1, 11), (y0 + start, y0 + end, 12, 9), (y0 + end, y1, 21, 11)):
        block = room.raster(image, [x0, sy0, x1, sy1], (width, h), palette)
        result[ty:ty + h, left:left + width] = block
    return furniture.outlined(result)


def normalized_rows(item: dict, look: str, lengths: tuple[int, ...], max_width: int) -> list[list[np.ndarray]]:
    image = load_source(item)
    rows, cursor = [], 0
    for length in lengths:
        frames = item["frames"][cursor:cursor + length]
        split = tuple(int(np.median([f["torsoY"][i] for f in frames])) for i in (0, 1))
        source_width = max(f["box"][2] - f["box"][0] for f in frames)
        rows.append([raw_pose(image, f, look, max_width / source_width, split) for f in frames])
        cursor += length
    return rows


def hand_layer(pose: np.ndarray, look: str, roi: np.ndarray, sleeves: bool = False) -> np.ndarray:
    seeds = colors_mask(pose, SKIN[look]) & roi
    if sleeves and look == "look-01":
        yy, xx = np.indices((32, 16))
        cuff = colors_mask(pose, ("ffffff", "c0cbdc")) & (yy >= 14) & ((xx <= 5) | (xx >= 10))
        seeds |= cuff & roi
    mask = seeds | (dilate(seeds) & colors_mask(pose, ("181425",)))
    output = np.zeros_like(pose)
    output[mask] = pose[mask]
    return output


def leg_plane(pose: np.ndarray) -> np.ndarray:
    output = np.zeros_like(pose)
    mask = colors_mask(pose, GREY)
    mask[:21] = False
    output[mask] = pose[mask]
    yy, _ = np.where(output[:, :, 3] == 255)
    if not len(yy):
        raise ValueError("Missing walking legs")
    # Normalize the sole contact while retaining a raised non-supporting foot.
    if yy.max() < 31:
        shift = int(31 - yy.max())
        output[21 + shift:] = output[21:32 - shift].copy()
        for y in range(21, 21 + shift):
            output[y] = output[21 + shift]
    return output


def build_walks(config: dict, sprites: dict) -> tuple[dict, dict]:
    raw = {look: normalized_rows(config[look + "-walk"], look, (4, 4, 4, 2), 14) for look in ("look-01", "look-02")}
    # Both approved workers wear the same grey trousers and dark shoes. Retarget
    # the clearer male source gait to both, preserving each one's head and outfit.
    legs = [[leg_plane(pose) for pose in row] for row in raw["look-02"][:3]]
    repairs = []
    for direction, row in zip(VIEWS, legs):
        if len({p[21:].tobytes() for p in row}) < 3:
            row[3] = row[1][:, ::-1].copy()
            grey = row[0].copy()
            a, b = colors_mask(grey, ("262b44",)), colors_mask(grey, ("3a4466",))
            grey[a], grey[b] = rgba("3a4466"), rgba("262b44")
            row[2] = grey
            repairs.append(direction)
    result = {}
    for look in ("look-01", "look-02"):
        rows = []
        for d, view in enumerate(VIEWS):
            base = sprites[f"{look}-{view}"]
            row = []
            for i, pose in enumerate(raw[look][d]):
                frame = pose.copy()
                frame[:12] = base[:12]
                frame[12:21, 5:11] = base[12:21, 5:11]
                frame[21:] = legs[d][i][21:]
                roi = np.zeros((32, 16), dtype=bool)
                roi[12:25] = True
                frame = overlay(frame, hand_layer(pose, look, roi))
                row.append(clean_keys(frame))
            rows.append(row)
        idle = sprites[f"{look}-front"].copy()
        breath = idle.copy()
        # Raise the outer shoulder/sleeve clusters by one pixel. Head, waist,
        # hands and soles remain fixed; this is motion rather than color flicker.
        breath[12:17, 1:5] = idle[13:18, 1:5]
        breath[12:17, 11:15] = idle[13:18, 11:15]
        rows.append([idle, clean_keys(breath)])
        result[look] = rows
    return result, {"sharedTrouserGaitFrom": "look-02-walk", "pixelPhaseRepairs": repairs}


def build_work(config: dict, sprites: dict) -> tuple[dict, dict]:
    chair = np.zeros((32, 16, 4), dtype=np.uint8)
    chair[8:] = sprites["chair-front"]
    result, foregrounds = {}, {}
    for look in ("look-01", "look-02"):
        raw = normalized_rows(config[look + "-desk-work"], look, (3, 3, 3, 3), 16)
        person = sprites[f"{look}-front"]
        fixed = chair.copy()
        # One immutable seated lower body, including chair wheels and shoes.
        lower = leg_plane(raw[0][0])
        fixed = overlay(fixed, lower)
        core = np.zeros_like(fixed)
        core[12:21, 5:11] = person[12:21, 5:11]
        fixed = overlay(fixed, core)
        rows, hand_rows = [], []
        for r, task in enumerate(TASKS):
            row, hand_row = [], []
            for i, pose in enumerate(raw[r]):
                frame = fixed.copy()
                yy, xx = np.indices((32, 16))
                limb_roi = (yy >= 12) & (yy <= 24) & ((xx < 5) | (xx >= 11))
                colored = (chars.key_mask(pose) | colors_mask(pose, SKIN[look])) & limb_roi
                if look == "look-01":
                    colored |= colors_mask(pose, ("ffffff", "c0cbdc")) & limb_roi
                outline = colors_mask(pose, ("181425",)) & dilate(colored)
                moving = colored | outline
                frame[moving] = pose[moving]
                dy = 1 if task == "read" else -1 if task == "think" and i == 1 else 0
                head = np.zeros_like(frame)
                for y in range(12):
                    if 0 <= y + dy < 32:
                        head[y + dy] = person[y]
                frame = overlay(frame, head)
                if dy == -1:
                    frame[11, 6:10] = person[11, 6:10]
                roi = np.zeros((32, 16), dtype=bool)
                roi[12:25] = True
                if task == "think" and i == 0:
                    roi[10:16, 4:11] = True
                if task == "think" and i == 2:
                    roi[3:13, 11:15] = True
                hands = hand_layer(pose, look, roi, sleeves=True)
                frame = clean_keys(overlay(frame, hands))
                row.append(frame)
                # Only skin and its immediate contour are replayed above props.
                hand_row.append(hand_layer(pose, look, roi))
            if len({f.tobytes() for f in row}) < 2:
                raise ValueError(f"Gesture lost at 16px: {look}/{task}")
            rows.append(row)
            hand_rows.append(hand_row)
        result[look], foregrounds[look] = rows, hand_rows
    return result, foregrounds


def build_props(item: dict) -> list[list[np.ndarray]]:
    source = load_source(item)
    palette = ["181425", "a22633", "be4a2f", "733e39", "ffffff", "ead4aa", "c0cbdc", "8b9bb4", "5a6988", "fee761", "feae34", "b86f50", "e43b44"]
    books, notes = [], []
    for i, spec in enumerate(item["frames"][:4]):
        x0, y0, x1, y1 = spec["box"]
        pixels = furniture.sample(source, [x0, 337, x1, 579], (16, 16), palette)
        if i:
            pixels[13:] = books[0][13:]
        books.append(pixels)
    for i, spec in enumerate(item["frames"][4:]):
        x0, y0, x1, y1 = spec["box"]
        pixels = furniture.sample(source, [x0, 737, x1, 997], (16, 16), palette)
        pixels[7:14, 2:8] = rgba("ffffff")
        for line in range(i + 1):
            pixels[8 + 2 * line, 3:7] = rgba("5a6988")
        if i:
            pixels[15] = notes[0][15]
        notes.append(pixels)
    return [books, notes]


def save_sheet(path: Path, rows: list[list[np.ndarray]], cell: tuple[int, int]) -> None:
    w, h = cell
    width = max(len(r) for r in rows) * w
    image = np.zeros((len(rows) * h, width, 4), dtype=np.uint8)
    for r, row in enumerate(rows):
        for i, pixels in enumerate(row):
            image[r * h:(r + 1) * h, i * w:(i + 1) * w] = pixels
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(image).save(path)


def add_to_atlas(atlas: dict, walks: dict, work: dict, hands: dict, props: list) -> dict:
    atlas.setdefault("auxiliaryImages", {})
    for look in ("look-01", "look-02"):
        animations = {}
        for category, rows, names, durations in (
            ("walk", walks[look], ("walk-front", "walk-back", "walk-right", "idle"), (120, 120, 120, 700)),
            ("desk-work", work[look], TASKS, (160, 220, 160, 500))):
            image = f"characters/{look}/{category}.png"
            save_sheet(OUT / image, rows, (16, 32))
            atlas["meta"]["images"][image] = {"width": max(len(r) for r in rows) * 16, "height": 128}
            pixels = np.asarray(Image.open(OUT / image).convert("RGBA"))
            mask = np.zeros_like(pixels)
            mask[chars.key_mask(pixels)] = rgba("ffffff")
            mask_name = f"characters/{look}/{category}-recolor-mask.png"
            Image.fromarray(mask).save(OUT / mask_name)
            atlas["auxiliaryImages"][mask_name] = {"width": pixels.shape[1], "height": 128, "kind": "recolor-mask"}
            for r, (row, action, duration) in enumerate(zip(rows, names, durations)):
                name = look + "-" + action
                states = []
                for i in range(len(row)):
                    key = name + "-" + str(i)
                    entry = {"image": image, "x": i * 16, "y": r * 32, "width": 16, "height": 32,
                             "frames": 1, "anchor": [8, 32], "feetBaseline": 32, "footprintTiles": [1, 1]}
                    if category == "desk-work":
                        entry["includesChair"] = True
                        entry["foregroundImage"] = f"characters/{look}/desk-work-hands.png"
                    atlas["sprites"][key] = entry
                    states.append(key)
                animation = {"image": image, "x": 0, "y": r * 32, "width": 16, "height": 32,
                             "frames": len(row), "frameDurationMs": duration, "loop": True, "states": states,
                             "anchor": [8, 32], "recolorMask": mask_name}
                if category == "desk-work":
                    animation["includesChair"] = True
                    animation["foregroundImage"] = f"characters/{look}/desk-work-hands.png"
                    if action != "think":
                        animation["prop"] = {"mount": [0, 12], "sprite": "laptop-back-open"} if action == "type" else {
                            "mount": [0, 12], "animation": "book-page-turn" if action == "read" else "notepad-write",
                            "frameMap": [0, 1, 3] if action == "read" else [0, 1, 2]}
                atlas["animations"][name] = animation
                animations[action] = name
            atlas["characters"][look].setdefault("animationMasks", {})[category] = mask_name
        foreground_name = f"characters/{look}/desk-work-hands.png"
        save_sheet(OUT / foreground_name, hands[look], (16, 32))
        atlas["auxiliaryImages"][foreground_name] = {"width": 48, "height": 128, "kind": "hand-foreground"}
        atlas["characters"][look]["animations"] = animations
        atlas["characters"][look]["mirrorWalkLeftFrom"] = animations["walk-right"]
    prop_image = "props/work-a.png"
    save_sheet(OUT / prop_image, props, (16, 16))
    atlas["meta"]["images"][prop_image] = {"width": 64, "height": 32}
    for r, (row, name) in enumerate(zip(props, ("book-page-turn", "notepad-write"))):
        states = []
        for i in range(len(row)):
            key = name + "-" + str(i)
            atlas["sprites"][key] = {"image": prop_image, "x": i * 16, "y": r * 16,
                                      "width": 16, "height": 16, "frames": 1, "anchor": [8, 16]}
            states.append(key)
        atlas["animations"][name] = {"image": prop_image, "x": 0, "y": r * 16, "width": 16, "height": 16,
                                     "frames": len(row), "frameDurationMs": 180, "loop": True, "states": states}
    room.floors.save_json(OUT / "atlas.json", atlas)
    return atlas


def validate(atlas: dict, gait: dict) -> dict:
    images, sprites = room.read_sprites(atlas)
    assert len(sprites) == 118 and len(atlas["animations"]) == 23
    palette = set(room.floors.PALETTE)
    for name, pixels in images.items():
        expected = atlas["meta"]["images"][name]
        assert pixels.shape[:2] == (expected["height"], expected["width"])
        assert set(np.unique(pixels[:, :, 3])) <= {0, 255}
        assert {tuple(c) for c in pixels[pixels[:, :, 3] == 255, :3].tolist()} <= palette
        coverage = np.zeros(pixels.shape[:2], dtype=np.uint8)
        for key, entry in atlas["sprites"].items():
            if entry["image"] != name:
                continue
            x, y, w, h = (entry[k] for k in ("x", "y", "width", "height"))
            assert 0 <= x <= pixels.shape[1] - w and 0 <= y <= pixels.shape[0] - h
            coverage[y:y + h, x:x + w] += 1
            assert sprites[key].shape == (h, w, 4)
        assert coverage.max() == 1 and not pixels[coverage == 0, 3].any()
    detail = {}
    for look in ("look-01", "look-02"):
        detail[look] = {}
        seated_base = sprites[f"{look}-type-0"][26:]
        for action, animation_name in atlas["characters"][look]["animations"].items():
            animation = atlas["animations"][animation_name]
            frames = [sprites[k] for k in animation["states"]]
            assert all(frame.shape == (32, 16, 4) for frame in frames)
            assert all(frame[31, :, 3].any() for frame in frames), (look, action, "ground contact")
            assert len({f.tobytes() for f in frames}) >= 2, (look, action, "no motion")
            for i, (key, frame) in enumerate(zip(animation["states"], frames)):
                entry = atlas["sprites"][key]
                assert entry["x"] == animation["x"] + i * 16 and entry["y"] == animation["y"]
                mask = chars.key_mask(frame)
                assert not mask[:12].any() and not mask[21:].any()
                assert all(np.all(frame == shade, axis=2).any() for shade in chars.KEYS), (look, action, i, "missing shade")
                for shades in (chars.GREEN, chars.RED):
                    swapped = chars.recolor(frame, shades)
                    assert np.array_equal(frame[~mask], swapped[~mask])
            if action.startswith("walk-"):
                view = action.split("-")[1]
                assert all(np.array_equal(f[:12], sprites[f"{look}-{view}"][:12]) for f in frames)
                count = len({f[23:].tobytes() for f in frames})
                assert count >= 3, (look, action, "insufficient leg motion", count)
                detail[look][action] = {"frames": len(frames), "distinctLegPoses": count}
            else:
                if action == "idle":
                    assert np.array_equal(frames[0][:12], frames[1][:12])
                    assert np.array_equal(frames[0][21:], frames[1][21:])
                    assert np.any(frames[0][:, :, 3] != frames[1][:, :, 3]), "Breathing must move the shoulder silhouette"
                else:
                    assert all(np.array_equal(f[26:], seated_base) for f in frames), "Seated feet/chair base jitter"
                detail[look][action] = {"frames": len(frames), "distinctPoses": len({f.tobytes() for f in frames})}
        for category in ("walk", "desk-work"):
            image = images[f"characters/{look}/{category}.png"]
            mask = np.asarray(Image.open(OUT / f"characters/{look}/{category}-recolor-mask.png").convert("RGBA"))
            assert np.array_equal(mask[:, :, 3] == 255, chars.key_mask(image))
        hands = np.asarray(Image.open(OUT / f"characters/{look}/desk-work-hands.png").convert("RGBA"))
        assert not chars.key_mask(hands).any()
        assert set(np.unique(hands[:, :, 3])) <= {0, 255}
    for name, dims in atlas["auxiliaryImages"].items():
        pixels = np.asarray(Image.open(OUT / name).convert("RGBA"))
        assert pixels.shape[:2] == (dims["height"], dims["width"])
        assert set(np.unique(pixels[:, :, 3])) <= {0, 255}
        assert {tuple(c) for c in pixels[pixels[:, :, 3] == 255, :3].tolist()} <= palette
    for animation in atlas["animations"].values():
        for i, key in enumerate(animation["states"]):
            entry = atlas["sprites"][key]
            assert entry["image"] == animation["image"] and entry["x"] == animation["x"] + i * animation["width"]
            assert entry["y"] == animation["y"]
    books = [sprites[f"book-page-turn-{i}"] for i in range(4)]
    assert len({p.tobytes() for p in books}) == 4
    assert all(np.array_equal(p[13:], books[0][13:]) for p in books[1:])
    notes = [sprites[f"notepad-write-{i}"] for i in range(3)]
    assert len({p.tobytes() for p in notes}) == 3
    assert json.loads((ROOT / "art/checks/characters-quality.json").read_text(encoding="utf-8"))["status"] == "passed"
    return {"status": "passed", "totalSprites": 118, "totalAnimations": 23, "newCharacterFrames": 52,
            "newPropFrames": 7, "frameSize": [16, 32], "feetBaseline": 32, "palette": "ENDESGA 32",
            "alphaLevels": [0, 255], "headsMatchApprovedWalkingViews": "passed", "distinctWalkingLegPoses": "passed",
            "workGestures": "passed", "breathingMovesShoulders": "passed", "seatedFeetAndChairBase": "passed",
            "atlasBoundsAndOverlap": "passed", "clothingMasksAndRecolor": "passed",
            "separatePropsAndHandOverlays": "passed", "gaitNormalization": gait, "actions": detail, "previewScale": 3}


def main() -> None:
    chars.main()
    atlas = json.loads((OUT / "atlas.json").read_text(encoding="utf-8"))
    _, sprites = room.read_sprites(atlas)
    config = json.loads((ROOT / "art/animation-source.json").read_text(encoding="utf-8"))
    walks, gait = build_walks(config, sprites)
    work, hands = build_work(config, sprites)
    props = build_props(config["work-a-desk"])
    atlas = add_to_atlas(atlas, walks, work, hands, props)
    report = validate(atlas, gait)
    from animation_previews import build
    report.update(build(atlas))
    room.floors.save_json(ROOT / "art/checks/animation-quality.json", report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
