"""Run with Python + Pillow (e.g. ComfyUI's python_embeded); read originals from assest/source and rebuild compact runtime sheets under public/.
Full-size art dropped into runtime/ must be copied to assest/source first: this script empties each runtime folder it rebuilds."""
import json
import shutil
from statistics import median
from pathlib import Path, PureWindowsPath

from PIL import Image

REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / 'assest/source/1113_characters'
RUNTIME = REPO / 'public/test-assets/1113_characters/runtime'
metadata = {}
for folder in ['S1AW', 'S2AM', 'S2LW', 'S3WW', 'Chris', 'GO', 'Joneey', 'Tony', 'SE7EN']:
    source = SOURCE / folder
    manifest = source / 'game_manifest.json'
    data = json.loads(manifest.read_text(encoding='utf-8')) if manifest.exists() else None
    # ponytail: Tony lacks a manifest; matching 4-column PNG geometry supplies counts until provided.
    cell, fps = (data['cell_width'], data['gif_fps']) if data else (1024, 16)
    entries = {entry['id']: entry for entry in data['actions']} if data else {p.stem: {'sprite_sheet': p.name} for p in sorted(source.glob('*.png'))}
    assert len(entries) == 15 and cell > 0 and fps > 0 and (not data or data['cell_height'] == cell), folder
    actions = {}
    destination = RUNTIME / folder
    shutil.rmtree(destination, ignore_errors=True)
    destination.mkdir(parents=True)
    # Originals stay beside the compact sheets: boot preloads 256 px cells, large views load full/ on demand.
    (destination / 'full').mkdir()
    for action, entry in entries.items():
        filename = PureWindowsPath(entry['sprite_sheet']).name
        shutil.copyfile(source / filename, destination / 'full' / filename)
        with Image.open(source / filename) as image:
            assert image.width == cell * 4 and image.height % cell == 0, (folder, filename)
            frames = entry.get('frame_count', image.width // cell * (image.height // cell))
            assert 0 < frames <= 4 * (image.height // cell), (folder, filename)
            image.resize((1024, image.height * 256 // cell), Image.Resampling.LANCZOS).save(destination / filename)
        actions[action[:2]] = {'filename': filename, 'frames': frames}
    with Image.open(source / actions['02']['filename']) as idle:
        baselines = [idle.crop((i % 4 * cell, i // 4 * cell, (i % 4 + 1) * cell, (i // 4 + 1) * cell)).getchannel('A').getbbox()[3] for i in range(actions['02']['frames'])]
    metadata[folder.lower()] = {'folder': folder, 'size': 256, 'sourceCellSize': cell, 'originY': median(baselines) / cell, 'fps': fps, 'manifestFallback': data is None, 'actions': actions}
(Path(__file__).resolve().parents[1] / 'src/game/ui/animation/AlignedSpriteData.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
print(f'Prepared {len(metadata)} characters, {sum(len(m["actions"]) for m in metadata.values())} sheets')
