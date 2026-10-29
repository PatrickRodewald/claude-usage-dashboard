#!/usr/bin/env python3
"""Normalize the approved AI floor draft into a verified, 16 px game atlas.

Run from any directory. Only Pillow and NumPy are required. The source image
is preserved; all outputs are written beneath the kit root.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
TILE = 16
SCALE = 3
HEX = """
ead4aa e8b796 e4a672 c28569 b86f50 733e39 3e2731
be4a2f d77643 a22633 e43b44 f77622 ff0044 feae34 fee761
63c74d 3e8948 265c42 193c3e 124e89 0099db 2ce8f5
ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 181425
68386c b55088 f6757a
""".split()
PALETTE = [tuple(bytes.fromhex(h)) for h in HEX]


def color(h: str) -> tuple[int, int, int, int]:
    return (*bytes.fromhex(h), 255)


def save_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sample_tile(image: Image.Image, box: list[int], allowed: list[str]) -> np.ndarray:
    """Area-mode reduction, with no dithering or interpolated output colors."""
    crop = np.asarray(image.crop(tuple(box)).convert("RGB"), dtype=np.float32)
    palette = np.array([tuple(bytes.fromhex(h)) for h in allowed], dtype=np.float32)
    indices = ((crop[:, :, None, :] - palette[None, None, :, :]) ** 2).sum(3).argmin(2)
    height, width = indices.shape
    out = np.empty((TILE, TILE, 4), dtype=np.uint8)
    for y in range(TILE):
        for x in range(TILE):
            block = indices[y * height // TILE:(y + 1) * height // TILE,
                            x * width // TILE:(x + 1) * width // TILE]
            mode = np.bincount(block.ravel(), minlength=len(allowed)).argmax()
            out[y, x] = (*palette[mode].astype(np.uint8), 255)
    return out


def normalize_wood(image: Image.Image, box: list[int]) -> np.ndarray:
    """Restore thin plank joints lost at 16 px and snap all rows to a period.

    Joint positions are measured from the source draft, then moved to safe
    interior columns. The 4 px plank period makes the vertical tile boundary
    the same dark-to-light transition as each internal plank boundary.
    """
    raw = image.crop(tuple(box)).convert("RGB").resize((TILE, TILE), Image.Resampling.BOX)
    luminance = np.asarray(raw, dtype=np.float32).mean(2)
    mid, light, dark = color("d77643"), color("e4a672"), color("b86f50")
    out = np.empty((TILE, TILE, 4), dtype=np.uint8)
    out[:] = mid
    for row in range(4):
        y = row * 4
        # Keep junctions away from shared tile edges; retain the source layout.
        joint = int(np.argmin(luminance[y + 1:y + 3, 3:13].mean(0))) + 3
        out[y, :] = light
        out[y + 3, :] = dark
        out[y + 1:y + 3, joint] = dark
    return out


def normalize_periodic_edges(tile: np.ndarray) -> np.ndarray:
    """Remove sparse edge blemishes, using the most frequent source color."""
    colors, counts = np.unique(tile.reshape(-1, 4), axis=0, return_counts=True)
    base = colors[counts.argmax()]
    out = tile.copy()
    out[0, :] = base
    out[-1, :] = base
    out[:, 0] = base
    out[:, -1] = base
    return out


def normalize_checker(tile: np.ndarray) -> np.ndarray:
    """Snap the draft's 4 by 4 checker pattern to 4 px squares."""
    out = tile.copy()
    shades = [color("ead4aa"), color("c0cbdc")]
    for y in range(4):
        for x in range(4):
            out[y * 4:(y + 1) * 4, x * 4:(x + 1) * 4] = shades[(x + y) % 2]
    return out


def normalize_rug(image: Image.Image, boxes: list[list[int]]) -> list[np.ndarray]:
    """Quantize, flatten and align the draft's nine rug segments.

    Snap the perimeter to a 3 px border with a 1 px outer rim. Internal edges
    have no outline. Remove all source alpha fringes and corner debris.
    """
    pieces = []
    for i, box in enumerate(boxes):
        tile = sample_tile(image, box, ["ead4aa", "8b9bb4", "5a6988"])
        tile[:] = color("ead4aa")
        row, col = divmod(i, 3)
        distances = []
        yy, xx = np.indices((TILE, TILE))
        if row == 0:
            distances.append(yy)
        if row == 2:
            distances.append(TILE - 1 - yy)
        if col == 0:
            distances.append(xx)
        if col == 2:
            distances.append(TILE - 1 - xx)
        if distances:
            distance = np.minimum.reduce(distances)
            tile[distance < 3] = color("8b9bb4")
            tile[distance == 0] = color("5a6988")
        if row != 1 and col != 1:
            tile[0 if row == 0 else 15, 0 if col == 0 else 15] = (0, 0, 0, 0)
        pieces.append(tile)
    return pieces


def compose(tiles: dict[str, np.ndarray], atlas: dict, keys: list[list[str]]) -> Image.Image:
    out = Image.new("RGBA", (len(keys[0]) * TILE, len(keys) * TILE))
    for y, row in enumerate(keys):
        for x, name in enumerate(row):
            out.paste(Image.fromarray(tiles[name]), (x * TILE, y * TILE))
    return out


def render_preview(tiles: dict[str, np.ndarray], atlas: dict, sheet: Image.Image) -> None:
    background = "#181425"
    canvas = Image.new("RGB", (960, 930), background)
    draw = ImageDraw.Draw(canvas)
    font_dir = Path("/usr/share/fonts/truetype/dejavu")

    def font(size: int, bold: bool = False):
        path = font_dir / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")
        return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default(size=size)

    draw.text((36, 24), "Pixel-Büro · Bodenprüfung", font=font(25, True), fill="#ffffff")
    draw.text((36, 65), "16 × 16 px je Kachel · Ansicht 3× ohne Glättung · ENDESGA 32", font=font(15), fill="#c0cbdc")

    def panel(x: int, y: int, title: str, image: Image.Image, note: str = "") -> None:
        draw.text((x, y), title, font=font(17, True), fill="#ffffff")
        scaled = image.resize((image.width * SCALE, image.height * SCALE), Image.Resampling.NEAREST)
        # Checkerboard makes real transparent pixels visible without changing assets.
        checker = Image.new("RGB", scaled.size, "#262b44")
        cd = ImageDraw.Draw(checker)
        for cy in range(0, checker.height, 12):
            for cx in range(0, checker.width, 12):
                if ((cx // 12) + (cy // 12)) % 2:
                    cd.rectangle((cx, cy, cx + 11, cy + 11), fill="#3a4466")
        checker.paste(scaled, mask=scaled.getchannel("A"))
        canvas.paste(checker, (x, y + 32))
        if note:
            draw.text((x, y + 40 + scaled.height), note, font=font(12), fill="#c0cbdc")

    floors = [("wood-a", "Holz A"), ("wood-b", "Holz B"), ("carpet", "Büroteppich"),
              ("kitchen", "Küchenfliesen"), ("hallway", "Flurbelag")]
    for i, (name, title) in enumerate(floors):
        x, y = 36 + (i % 3) * 310, 112 + (i // 3) * 240
        patch = compose(tiles, atlas, [[name] * 3 for _ in range(3)])
        panel(x, y, title, patch, "3 × 3 Kacheln nebeneinander")

    rug_keys = [["rug-top-left", "rug-top", "rug-top-right"],
                ["rug-left", "rug-center", "rug-right"],
                ["rug-bottom-left", "rug-bottom", "rug-bottom-right"]]
    panel(656, 352, "Teppich: neun Teile", compose(tiles, atlas, rug_keys), "Transparente äußere Eckpixel")

    wood_keys = [["wood-a" if (x + y) % 2 else "wood-b" for x in range(6)] for y in range(4)]
    rug_large = [["rug-top-left", *(["rug-top"] * 4), "rug-top-right"],
                 *([["rug-left", *(["rug-center"] * 4), "rug-right"]] * 2),
                 ["rug-bottom-left", *(["rug-bottom"] * 4), "rug-bottom-right"]]
    panel(36, 606, "Holzvarianten gemischt", compose(tiles, atlas, wood_keys), "6 × 4 Kacheln · gleiche Anschlusskanten")
    panel(346, 606, "Teppich gestreckt", compose(tiles, atlas, rug_large), "6 × 4 Kacheln · unverzerrte Ränder")
    panel(656, 606, "Fertiges Atlasbild", sheet, "80 × 64 px · 14 belegte Felder")
    draw.text((36, 894), "Zahlen und Beschriftungen gehören zur Prüfansicht; die Spielgrafiken enthalten keinen Text.",
              font=font(12), fill="#8b9bb4")
    canvas.save(ROOT / "art/checks/floor-preview.png")


def validate(sheet_path: Path, atlas_path: Path) -> dict:
    """Read the saved PNG/JSON back and verify their actual consumer contract."""
    sheet = Image.open(sheet_path).convert("RGBA")
    data = json.loads(atlas_path.read_text(encoding="utf-8"))
    pixels = np.asarray(sheet)
    assert sheet.size == (80, 64), sheet.size
    assert set(np.unique(pixels[:, :, 3])) == {0, 255}, "Partial alpha remains"
    visible = pixels[pixels[:, :, 3] == 255, :3]
    visible_colors = {tuple(c) for c in visible.tolist()}
    assert visible_colors <= set(PALETTE), "Out-of-palette color"
    assert len(data["sprites"]) == 14, "Missing tile"
    coverage = np.zeros((sheet.height, sheet.width), dtype=np.uint8)
    tiles = {}
    for name, sprite in data["sprites"].items():
        x, y, w, h = (sprite[k] for k in ("x", "y", "width", "height"))
        assert w == h == TILE and x % TILE == y % TILE == 0
        assert 0 <= x <= sheet.width - w and 0 <= y <= sheet.height - h
        assert sprite["image"] == "tiles/floor.png" and sprite["frames"] == 1
        coverage[y:y + h, x:x + w] += 1
        tiles[name] = pixels[y:y + h, x:x + w]
    assert coverage.max() == 1, "Overlapping atlas frames"
    assert not pixels[coverage == 0, 3].any(), "Unused atlas cells are not transparent"

    floor_names = ["wood-a", "wood-b", "carpet", "kitchen", "hallway"]
    for name in floor_names:
        assert (tiles[name][:, :, 3] == 255).all(), f"Hole in {name}"
    for left in ("wood-a", "wood-b"):
        for right in ("wood-a", "wood-b"):
            assert np.array_equal(tiles[left][:, -1], tiles[right][:, 0]), "Wood side seam"
            # A wood joint continues the 4 px plank rhythm at the tile boundary.
            actual = np.stack((tiles[left][-1], tiles[right][0]))
            internal = np.stack((tiles[left][3], tiles[right][4]))
            assert np.array_equal(actual, internal), "Wood vertical period broken"
    for name in ("carpet", "hallway"):
        tile = tiles[name]
        assert np.array_equal(tile[0], tile[-1]) and np.array_equal(tile[:, 0], tile[:, -1])
    # Check each kitchen boundary against an equivalent interior checker transition.
    kitchen = tiles["kitchen"]
    assert np.array_equal(np.stack((kitchen[-1], kitchen[0])), np.stack((kitchen[7], kitchen[8])))
    assert np.array_equal(np.stack((kitchen[:, -1], kitchen[:, 0])), np.stack((kitchen[:, 7], kitchen[:, 8])))
    rug = data["nineSlice"]["rug"]["parts"]
    for y in range(3):
        for x in range(2):
            assert np.array_equal(tiles[rug[y][x]][:, -1], tiles[rug[y][x + 1]][:, 0]), "Rug horizontal seam"
    for y in range(2):
        for x in range(3):
            assert np.array_equal(tiles[rug[y][x]][-1], tiles[rug[y + 1][x]][0]), "Rug vertical seam"
    # Repeating center/edge pieces must also connect on a larger rug.
    for name in ("rug-top", "rug-center", "rug-bottom"):
        assert np.array_equal(tiles[name][:, -1], tiles[name][:, 0])
    for name in ("rug-left", "rug-center", "rug-right"):
        assert np.array_equal(tiles[name][-1], tiles[name][0])
    return {"status": "passed", "tileSize": [16, 16], "tileCount": 14,
            "atlasSize": list(sheet.size), "visiblePaletteColors": len(visible_colors),
            "visibleColors": ["#" + bytes(c).hex() for c in sorted(visible_colors)],
            "alphaLevels": [0, 255], "opaqueFloorTiles": 5,
            "woodVariantsCompatible": True, "floorBoundaryChecks": "passed",
            "rugNineSliceAndStretchChecks": "passed", "atlasBoundsAndOverlapChecks": "passed",
            "previewScale": 3, "previewResampling": "nearest-neighbor"}


def main() -> None:
    config = json.loads((ROOT / "art/floor-source.json").read_text(encoding="utf-8"))
    source_path = ROOT / config["source"]
    digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
    if digest != config["sha256"]:
        raise ValueError("The source image differs from floor-source.json; review crop coordinates first.")
    source = Image.open(source_path).convert("RGBA")
    if list(source.size) != config["sourceSize"]:
        raise ValueError("Unexpected source dimensions")
    boxes = config["floorCrops"]
    tiles = {
        "wood-a": normalize_wood(source, boxes["wood-a"]),
        "wood-b": normalize_wood(source, boxes["wood-b"]),
        "carpet": normalize_periodic_edges(sample_tile(source, boxes["carpet"], ["5a6988", "8b9bb4"])),
        "kitchen": normalize_checker(sample_tile(source, boxes["kitchen"], ["ead4aa", "c0cbdc"])),
        "hallway": normalize_periodic_edges(sample_tile(source, boxes["hallway"], ["c0cbdc", "8b9bb4"])),
    }
    rug_names = ["rug-top-left", "rug-top", "rug-top-right", "rug-left", "rug-center", "rug-right",
                 "rug-bottom-left", "rug-bottom", "rug-bottom-right"]
    tiles.update(zip(rug_names, normalize_rug(source, config["rugCrops"])))
    sheet = Image.new("RGBA", (80, 64), (0, 0, 0, 0))
    atlas = {
        "meta": {"schemaVersion": 1, "tileSize": 16, "renderScale": 3,
                 "image": "tiles/floor.png", "width": 80, "height": 64,
                 "palette": "ENDESGA 32", "filter": "nearest", "padding": 0},
        "sprites": {},
        "nineSlice": {"rug": {"tileSize": 16, "borderPixels": 3, "minimumTiles": [3, 3],
                               "parts": [rug_names[:3], rug_names[3:6], rug_names[6:9]]}},
    }
    for i, (name, tile) in enumerate(tiles.items()):
        if i < 5:
            x, y = i * TILE, 0
        else:
            row, col = divmod(i - 5, 3)
            x, y = col * TILE, (row + 1) * TILE
        sheet.paste(Image.fromarray(tile), (x, y))
        atlas["sprites"][name] = {"image": "tiles/floor.png", "x": x, "y": y,
                                  "width": TILE, "height": TILE, "frames": 1}
    asset_dir = ROOT / "public/assets/office"
    (asset_dir / "tiles").mkdir(parents=True, exist_ok=True)
    (ROOT / "art/checks").mkdir(parents=True, exist_ok=True)
    sheet_path, atlas_path = asset_dir / "tiles/floor.png", asset_dir / "atlas.json"
    sheet.save(sheet_path)
    save_json(atlas_path, atlas)
    report = validate(sheet_path, atlas_path)
    report["source"] = {"size": list(source.size), "sha256": digest}
    save_json(ROOT / "art/checks/floor-quality.json", report)
    render_preview(tiles, atlas, sheet)
    palette_path = ROOT / "art/palettes/endesga-32.gpl"
    palette_path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["GIMP Palette", "Name: ENDESGA 32", "Columns: 8", "#"]
    lines.extend(f"{r:3} {g:3} {b:3}  #{h}" for (r, g, b), h in zip(PALETTE, HEX))
    palette_path.write_text("\n".join(lines) + "\n", encoding="ascii")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
