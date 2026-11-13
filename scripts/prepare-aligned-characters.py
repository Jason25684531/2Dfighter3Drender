"""Run with Python + Pillow; preserve originals and rebuild compact runtime sheets."""
import json
from statistics import median
from pathlib import Path, PureWindowsPath

from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'public/test-assets/1113_characters'
metadata = {}
for folder in ['S1AW', 'S2AM', 'S2LW', 'S3WW', 'Tony', 'Chris', 'GO', 'SE7EN']:
    source = ROOT / folder
    manifest = source / 'reference_aligned_manifest.json'
    data = json.loads(manifest.read_text(encoding='utf-8')) if manifest.exists() else None
    # ponytail: Tony/Chris lack manifests; matching 4-column PNG geometry supplies counts until provided.
    cell, fps = (data['cell_size'], data['gif_fps']) if data else (1024, 16)
    entries = data['actions'] if data else {p.stem: {'sprite_sheet': p.name} for p in sorted(source.glob('*.png'))}
    assert len(entries) == 15 and cell > 0 and fps > 0, folder
    actions = {}
    destination = ROOT / 'runtime' / folder
    destination.mkdir(parents=True, exist_ok=True)
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
(Path(__file__).resolve().parents[1] / 'src/game/ui/animation/AlignedSpriteData.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
print(f'Prepared {len(metadata)} characters, {sum(len(m["actions"]) for m in metadata.values())} sheets')
