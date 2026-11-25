"""Measure how large each character is drawn inside its sprite cells, per action and per frame.

The game scales every cell to the same height, so on-screen body size = figure height / cell height.
Usage: python scripts/audit-character-scale.py [extra character folders with game_manifest.json ...]
"""
import json
import sys
from pathlib import Path, PureWindowsPath
from statistics import median

from PIL import Image

REPO = Path(__file__).resolve().parents[1]
STANDING = ['02_Idle', '03_Move', '06_Block', '08_Punch_Light', '09_Punch_Heavy', '12_Kick_Light', '13_Kick_Heavy']


def folders():
    data = json.loads((REPO / 'src/game/ui/animation/AlignedSpriteData.json').read_text(encoding='utf-8'))
    yield from ((sprite['folder'], REPO / 'public/assest/characters' / sprite['folder']) for sprite in data.values())
    for extra in sys.argv[1:]:
        yield Path(extra).name, Path(extra)


def sheets(root):
    manifest = root / 'game_manifest.json'
    if not manifest.exists():
        manifest = root / 'manifest' / 'game_manifest.json'
    if manifest.exists():
        data = json.loads(manifest.read_text(encoding='utf-8'))
        for entry in data['actions']:
            name = PureWindowsPath(entry['sprite_sheet']).name
            path = next((p for p in (root / name, root / 'Sprite_Sheet_reference_aligned' / name) if p.exists()), None)
            if path:
                yield entry['id'], path, data['cell_width'], entry['frame_count']
    else:
        for path in sorted(root.glob('*.png')):
            yield path.stem, path, 1024, 8


def frames(path, cell, count):
    with Image.open(path) as image:
        alpha = image.getchannel('A')
        for i in range(count):
            mask = alpha.crop((i % 4 * cell, i // 4 * cell, (i % 4 + 1) * cell, (i // 4 + 1) * cell)).point(lambda v: 255 if v > 16 else 0)
            box = mask.getbbox()
            if box:
                # sqrt(opaque area) tracks body scale; bbox height also moves with pose (raised leg, crouch).
                yield (mask.histogram()[255] ** 0.5) / cell, box[3] / cell


rows = []
for name, root in folders():
    heights = {}
    for action, path, cell, count in sheets(root):
        measured = list(frames(path, cell, count))
        if measured:
            heights[action] = measured
    idle = median(h for h, _ in heights['02_Idle'])
    standing = {a: median(h for h, _ in heights[a]) / idle for a in STANDING if a in heights}
    worst = max(standing.items(), key=lambda kv: abs(kv[1] - 1))
    idle_spread = max(h for h, _ in heights['02_Idle']) / min(h for h, _ in heights['02_Idle'])
    move_spread = max(h for h, _ in heights['03_Move']) / min(h for h, _ in heights['03_Move'])
    feet = [b for a in STANDING if a in heights for _, b in heights[a]]
    rows.append((name, idle, worst, idle_spread, move_spread, max(feet) - min(feet), standing))

base = median(r[1] for r in rows)
print(f'{"character":<16}{"idle size/cell":>15}{"vs median":>10}{"idle frames max/min":>21}{"move max/min":>14}{"feet drift":>11}  worst standing action vs idle')
for name, idle, worst, idle_spread, move_spread, feet, _ in rows:
    print(f'{name:<16}{idle:>15.3f}{idle / base:>10.2f}{idle_spread:>21.2f}{move_spread:>14.2f}{feet:>11.3f}  {worst[0]} {worst[1]:.2f}')
print('\nper action body height / idle height:')
for name, *_, standing in rows:
    print(f'{name:<16}' + '  '.join(f'{a.split("_", 1)[1]}={v:.2f}' for a, v in standing.items()))
