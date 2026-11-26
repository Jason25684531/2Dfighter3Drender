"""Prepare the shipped UI/VFX PNGs and generate visual checks with Pillow."""

import json
import shutil
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/test-assets'
SOURCE = ROOT / 'assest/source/ui/UI切片_2026-11-20'
CHECKS = ROOT / 'outputs/ui-vfx-verification'
ATTACKS = {
    'LIGHT_PUNCH': ('Punch_Light_08_10_11', (290, 599, 955, 1331, 1667)),
    'HEAVY_PUNCH': ('Punch_Heavy_09_10_11', (385, 773, 1133, 1500)),
    'LIGHT_KICK': ('Kick_Light_12_14_15', (378, 753, 1165, 1533)),
    'HEAVY_KICK': ('Kick__Heavy_13_14_15', (283, 670, 1163, 1555)),
}
HUD_UNDER = (4, 5, 1, 6, 7, 9, 34, 14, 39, 21, 24, 46, 49)
HUD_OVER = (11, 12, 36, 37, 16, 17, 41, 42, 20, 23, 45, 48, 25, 50, 29, 54)
HUD_DYNAMIC = {
    'portrait-p1': 9, 'portrait-p2': 34, 'health-p1': 15, 'health-p2': 40,
    'life-p1-1': 22, 'life-p1-2': 19, 'life-p2-1': 47, 'life-p2-2': 44,
}
SELECT = {
    'silhouette-p2': 8, 'ring-p1': 9, 'ring-p2': 10, 'spotlight-p1': 11,
    'spotlight-p2': 12, 'cursor-p1': 46, 'cursor-p2': 66,
    **{f'body-card-{i}': 16 + i for i in range(1, 5)},
    # 51–54 are caption images, including an obsolete 20-slot roster count.
    **{f'decoration-{i}': i for i in (48, 49, 50)},
}


def prepare_attacks():
    output = ASSETS / 'vfx/attack'
    output.mkdir(parents=True, exist_ok=True)
    metadata = {}
    previews = Image.new('RGB', (960, 4 * 285), '#252832')
    for row, (attack, (filename, cuts)) in enumerate(ATTACKS.items()):
        src = Image.open(ROOT / 'assest/VFX/1123_fx' / f'{filename}.png').convert('RGBA')
        alpha = src.getchannel('A')
        solid = alpha.point(lambda pixel: 255 if pixel > 16 else 0)
        # Cut only at transparent columns of the projected frames. The fifth
        # light-punch interval intentionally groups both clusters of sparks.
        assert all(solid.crop((x, 0, x + 1, src.height)).getbbox() is None for x in cuts), filename
        bounds = (0, *cuts, src.width)
        boxes = []
        for left, right in zip(bounds, bounds[1:]):
            x0, y0, x1, y1 = solid.crop((left, 0, right, src.height)).getbbox()
            boxes.append((max(left, left + x0 - 12), max(0, y0 - 12),
                          min(right, left + x1 + 12), min(src.height, y1 + 12)))
        top = min(b[1] for b in boxes)
        height = max(b[3] for b in boxes) - top
        width = max(b[2] - b[0] for b in boxes) + 8
        strip = Image.new('RGBA', (width * len(boxes), height))
        preview = src.copy()
        draw = ImageDraw.Draw(preview)
        for i, box in enumerate(boxes):
            frame = src.crop(box)
            strip.paste(frame, (i * width + (width - frame.width) // 2, box[1] - top))
            draw.rectangle(box, outline='cyan', width=4)
            draw.text((box[0] + 4, box[1] + 4), str(i + 1), fill='white')
        name = attack.lower().replace('_', '-')
        strip.save(output / f'{name}.png')
        metadata[attack] = dict(key=f'fx-{name}', url=f'/test-assets/vfx/attack/{name}.png',
                                width=width, height=height, frames=len(boxes), peak=2, scale=1)
        previews.paste(preview.resize((960, 540)).crop((0, 135, 960, 405)), (0, row * 285),
                       preview.getchannel('A').resize((960, 540)).crop((0, 135, 960, 405)))
        ImageDraw.Draw(previews).text((8, row * 285), name, fill='white')
        print(f'{name}: {width}x{height}, {len(boxes)} frames')
    previews.save(CHECKS / 'attack-frame-boxes.png')
    return metadata


def prepare_overdrive():
    """Jeansen's effects (kicks: purple ROG OVERDRIVE, heavy punch: gold explosion): Phaser multi-atlas pages copied as-is."""
    for source, target in (('assest/VFX/rog-overdrive/atlas', 'vfx/rog-overdrive'), ('assest/VFX/1126_explosion/vfx/rog-overdrive/atlas', 'vfx/explosion')):
        folder = ASSETS / target
        folder.mkdir(parents=True, exist_ok=True)
        for name in ('rog-overdrive.json', 'rog-overdrive.png', 'rog-overdrive-2.png', 'rog-overdrive-3.png'):
            shutil.copyfile(ROOT / source / name, folder / name)


def swap_body_portraits(slices):
    """The design draws body 02's face on card 03 and vice versa (game body 02 = S2AM glasses).

    The two cards differ only in their portraits and digits, so start from the
    other card and redraw this card's digits. The no-portrait slices (36-39)
    show where the digits are.
    """
    def card(number):
        return Image.open(SOURCE / slices[number]['file']).convert('RGBA')

    for target, source in ((2, 3), (3, 2)):
        result, own, other = card(16 + source), card(35 + target), card(35 + source)
        digits = ImageChops.difference(own, other).convert('L').point(lambda d: 255 if d > 24 else 0).filter(ImageFilter.MaxFilter(5))
        # Bright glyph pixels from either digit; the old digit's leftover pixels get the blurred portrait behind them.
        glyph = lambda image: ImageChops.multiply(image.convert('L').point(lambda v: 255 if v > 110 else 0), digits)
        own_glyph = glyph(own).filter(ImageFilter.MaxFilter(3))
        result = Image.composite(result.filter(ImageFilter.MedianFilter(9)), result, glyph(other).filter(ImageFilter.MaxFilter(3)))
        result.paste(own, (0, 0), own_glyph)
        result.save(ASSETS / 'ui/select' / f'body-card-{target}.png')


def prepare_home():
    """P0 title screen: the 4K design halved to the 1920x1080 logical canvas."""
    source, folder = ROOT / 'assest/source/ui/P0_UI', ASSETS / 'ui/home'
    folder.mkdir(parents=True, exist_ok=True)
    with Image.open(source / 'GAME TITLE SCREEN.png') as image:
        image.convert('RGB').resize((1920, 1080), Image.Resampling.LANCZOS).save(folder / 'title-screen.jpg', quality=92)
    for name in ('START', 'LEADERBOARD', 'SETTINGS'):
        for suffix in ('', '_CHOSE'):
            with Image.open(source / f'{name}{suffix}.png') as image:
                size = (round(image.width / 2), round(image.height / 2))
                key = f'{name.lower()}{"-chosen" if suffix else ""}'
                image.resize(size, Image.Resampling.LANCZOS).save(folder / f'{key}.png')


def prepare_ui():
    manifest = json.loads((SOURCE / 'manifest.json').read_text(encoding='utf-8'))
    size = manifest['canvas']['w'], manifest['canvas']['h']
    groups = {group: [s for s in manifest['slices'] if s['group'] == group] for group in ('hud', 'select')}

    def layer(*numbers):
        canvas = Image.new('RGBA', size)
        for number in numbers:
            item = groups['hud'][number]
            canvas.alpha_composite(Image.open(SOURCE / item['file']).convert('RGBA'), (item['x'], item['y']))
        return canvas

    def output(group, entries):
        folder = ASSETS / 'ui' / group
        folder.mkdir(parents=True, exist_ok=True)
        result = {}
        for key, number in entries.items():
            item = groups[group][number]
            shutil.copyfile(SOURCE / item['file'], folder / f'{key}.png')
            result[key] = {**{k: item[k] for k in ('x', 'y', 'w', 'h')}, 'url': f'/test-assets/ui/{group}/{key}.png'}
        return result

    hud = output('hud', HUD_DYNAMIC)
    under, over = layer(*HUD_UNDER), layer(*HUD_OVER)
    for key, image in (('hud-under', under), ('hud-over', over)):
        x, y, right, bottom = image.getbbox()
        hud[key] = dict(x=x, y=y, w=right-x, h=bottom-y, url=f'/test-assets/ui/hud/{key}.png')
        image.crop((x, y, right, bottom)).save(ASSETS / 'ui/hud' / f'{key}.png')

    # Fill the sample values and portraits only in the design comparison.
    # The game supplies these independently at runtime.
    check = under.copy()
    check.alpha_composite(layer(10, 35, 15, 40, 19, 22, 44, 47))
    check.alpha_composite(over)
    check.alpha_composite(layer(*range(58, 72)))
    check.save(CHECKS / 'hud-rebuilt.png')
    reference = Image.open(next(SOURCE.rglob('_驗證_hud_切片拼回.png'))).convert('RGBA')
    opaque = reference.getchannel('A').point(lambda alpha: 255 if alpha == 255 else 0)
    diff = ImageChops.difference(check.convert('RGB'), reference.convert('RGB'))
    mean = sum(ImageStat.Stat(diff, opaque).mean) / 3
    print(f'HUD mean RGB difference (opaque reference): {mean:.2f}')
    assert mean <= 6, 'HUD exceeds the design comparison threshold'

    text_slots = dict(zip(
        ('timer', 'percent-p1', 'label-p1', 'tag-p1', 'name-p1', 'percent-p2', 'label-p2', 'tag-p2', 'name-p2'),
        (manifest['hudTexts'][i] for i in (5, 6, 7, 8, 9, 10, 11, 12, 13)),
    ))
    cells = [{**{k: c[k] for k in ('w', 'h')}, 'x': c['x'] + c['grid']['x'], 'y': c['y'] + c['grid']['y']}
             for c in manifest['selectCells']]
    select = output('select', SELECT)
    swap_body_portraits(groups['select'])
    panels = {key: {k: groups['select'][num][k] for k in ('x', 'y', 'w', 'h')}
              for key, num in {'panel-p1': 5, 'panel-p2': 6, 'body': 13, 'saga': 14, 'guest': 15,
                               'roster': 16, 'nickname': 56, 'rival': 57}.items()}
    return dict(hud=hud, hudText=text_slots, select=select, selectCells=cells, selectPanels=panels)


if __name__ == '__main__':
    CHECKS.mkdir(parents=True, exist_ok=True)
    prepare_home()
    prepare_overdrive()
    attacks = prepare_attacks()
    layout = prepare_ui()
    (ROOT / 'src/game/ui/assets/hudLayout.json').write_text(
        json.dumps(dict(attack=attacks, **layout), ensure_ascii=False, indent=2) + '\n', encoding='utf-8',
    )
