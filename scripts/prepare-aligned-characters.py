"""Rebuild compact character sheets beside the originals with Python + Pillow."""
import json
import shutil
from statistics import median
from pathlib import Path, PureWindowsPath

from PIL import Image

REPO = Path(__file__).resolve().parents[1]
CHARACTERS = REPO / 'public/assest/characters'
metadata = {}
for folder in ['S1AW', 'S2AM', 'S2LW', 'S3WW', 'GO', 'SE7EN', 'Joneey', 'YG', 'Tony', 'Chris', 'HW', 'HSI', 'JF', 'Grace', 'AK', 'Jeansen']:
    source = CHARACTERS / folder
    manifest = source / 'game_manifest.json'
    data = json.loads(manifest.read_text(encoding='utf-8')) if manifest.exists() else None
    # ponytail: Tony lacks a manifest; matching 4-column PNG geometry supplies counts until provided.
    cell, fps = (data['cell_width'], data['gif_fps']) if data else (1024, 16)
    entries = {entry['id']: entry for entry in data['actions']} if data else {p.stem: {'sprite_sheet': p.name} for p in sorted(source.glob('*.png'))}
    assert len(entries) == 15 and cell > 0 and fps > 0 and (not data or data['cell_height'] == cell), folder
    actions = {}
    destination = source / 'compact'
    if destination.resolve() != destination:
        raise ValueError(f'Expected compact directory inside the character folder: {destination}')
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir()
    for action, entry in entries.items():
        filename = PureWindowsPath(entry['sprite_sheet']).name
        with Image.open(source / filename) as image:
            assert image.width == cell * 4 and image.height % cell == 0, (folder, filename)
            frames = entry.get('frame_count', image.width // cell * (image.height // cell))
            assert 0 < frames <= 4 * (image.height // cell), (folder, filename)
            image.resize((1024, image.height * 256 // cell), Image.Resampling.LANCZOS).save(destination / filename)
        actions[action[:2]] = {'filename': filename, 'frames': frames}
    with Image.open(source / actions['02']['filename']) as idle:
        baselines = [idle.crop((i % 4 * cell, i // 4 * cell, (i % 4 + 1) * cell, (i // 4 + 1) * cell)).getchannel('A').getbbox()[3] for i in range(actions['02']['frames'])]
    metadata[folder.lower()] = {'folder': folder, 'size': 256, 'sourceCellSize': cell, 'originY': median(baselines) / cell, 'fps': fps, 'manifestFallback': data is None, 'actions': actions}
(REPO / 'src/game/ui/animation/AlignedSpriteData.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
print(f'Prepared {len(metadata)} characters, {sum(len(m["actions"]) for m in metadata.values())} sheets')
