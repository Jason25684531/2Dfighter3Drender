import base64
import json
from copy import deepcopy

from app.routes import generation

UI_WORKFLOW = {
    'nodes': [
        {'id': 1, 'type': 'PrimitiveInt', 'inputs': [{'name': 'value', 'widget': {'name': 'value'}, 'type': 'INT', 'link': None}], 'widgets_values': [4, 'fixed']},
        {'id': 2, 'type': 'String', 'inputs': [{'name': 'String', 'widget': {'name': 'String'}, 'type': 'STRING', 'link': None}], 'widgets_values': ['Jensen']},
        {'id': 3, 'type': 'LoadImage', 'inputs': [{'name': 'image', 'widget': {'name': 'image'}, 'type': 'COMBO', 'link': None}, {'name': 'upload', 'widget': {'name': 'upload'}, 'type': 'IMAGEUPLOAD', 'link': None}], 'widgets_values': ['images (1).jpg', 'image']},
        {'id': 4, 'type': 'TaskforceCharacterSlotSelector', 'inputs': [
            {'name': 'character_index', 'widget': {'name': 'character_index'}, 'type': 'INT', 'link': 1},
            {'name': 'user_name', 'widget': {'name': 'user_name'}, 'type': 'STRING', 'link': 2},
            {'name': 'slot_3_name', 'widget': {'name': 'slot_3_name'}, 'type': 'STRING', 'link': None},
            {'name': 'output_root', 'widget': {'name': 'output_root'}, 'type': 'STRING', 'link': None},
        ], 'widgets_values': [1, 'Player01', 'S1AM', 'taskforce_2028_ftg']},
        {'id': 5, 'type': 'TaskforceSaveImageToFolder', 'inputs': [{'name': 'images', 'type': 'IMAGE', 'link': 3}, {'name': 'wait_for', 'type': '*', 'link': None}], 'widgets_values': []},
    ],
    'links': [[1, 1, 0, 4, 0, 'INT'], [2, 2, 0, 4, 1, 'STRING'], [3, 3, 0, 5, 0, 'IMAGE']],
}


def action(number, name, frames=8):
    return {'id': f'{number}_{name}', 'frame_count': frames, 'rows': 2, 'cols': 4, 'cell_width': 1024, 'cell_height': 1024, 'sprite_sheet': f'Sprite_Sheet_reference_aligned/{number}_{name}.png'}


def write_output(folder, user_name, actions):
    for entry in actions:
        sheet = folder / entry['sprite_sheet']
        sheet.parent.mkdir(parents=True, exist_ok=True)
        sheet.write_bytes(b'png')
    (folder / 'manifest').mkdir(parents=True, exist_ok=True)
    (folder / 'manifest' / 'game_manifest.json').write_text(json.dumps({'user_name': user_name, 'cell_width': 1024, 'cell_height': 1024, 'gif_fps': 16, 'actions': actions}), encoding='utf-8')


PHOTO = 'data:image/jpeg;base64,' + base64.b64encode(b'\xff\xd8\xfftest').decode()


def fake_comfy(monkeypatch, tmp_path, workflow):
    path = tmp_path / 'workflow.json'
    path.write_text(json.dumps(workflow), encoding='utf-8')
    monkeypatch.setattr(generation, 'WORKFLOW', path)
    monkeypatch.setattr(generation, 'OUTPUT', tmp_path)
    calls = []

    class Response:
        def __init__(self, payload): self.payload = payload
        def raise_for_status(self): pass
        def json(self): return self.payload

    class Comfy:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, path, **kwargs):
            calls.append((path, kwargs))
            return Response({'name': 'photo.jpg'} if path == '/upload/image' else {'prompt_id': 'prompt-1'})
        async def get(self, path): return Response({'prompt-1': {'status': {'completed': True}}})

    monkeypatch.setattr(generation.httpx, 'AsyncClient', Comfy)
    return calls


def test_generation_submits_ui_workflow_and_reads_game_manifest(client, monkeypatch, tmp_path):
    calls = fake_comfy(monkeypatch, tmp_path, UI_WORKFLOW)
    result = client.post('/api/v1/generation', json={'name': 'Al ice', 'template': 3, 'photo': PHOTO})
    assert result.status_code == 200
    job = result.json()['job']
    assert calls[0][1]['files']['image'][1] == b'\xff\xd8\xfftest', 'the player photo is what gets uploaded'
    submitted = calls[1][1]['json']['prompt']
    assert submitted['1'] == {'class_type': 'PrimitiveInt', 'inputs': {'value': 3}}, 'template injected, control_after_generate value dropped'
    assert submitted['2']['inputs'] == {'String': 'Al ice'}
    assert submitted['3']['inputs']['image'] == 'photo.jpg', 'uploaded photo replaces the workflow sample image'
    assert submitted['4']['inputs'] == {'character_index': ['1', 0], 'user_name': ['2', 0], 'slot_3_name': 'S1AM', 'output_root': 'taskforce_2028_ftg'}
    assert submitted['5']['inputs'] == {'images': ['3', 0]}

    write_output(tmp_path / 'taskforce_2028_ftg' / 'Al_ice_S1AM', 'Al ice', [action('02', 'Idle'), action('05', 'Crouch', 4)])
    legacy = tmp_path / 'taskforce_2028_ftg' / 'Old_S2AM'
    legacy.mkdir()
    (legacy / 'reference_aligned_manifest.json').write_text(json.dumps({'cell_size': 1024, 'actions': {}}), encoding='utf-8')

    ready = client.get('/api/v1/generation/' + job).json()
    assert (ready['status'], ready['id'], ready['displayName'], ready['fps']) == ('ready', 'Al_ice_S1AM', 'Al ice', 16)
    assert ready['actions'] == {'02_Idle': {'filename': '02_Idle.png', 'frames': 8, 'cellSize': 1024}, '05_Crouch': {'filename': '05_Crouch.png', 'frames': 4, 'cellSize': 1024}}
    assert [asset['id'] for asset in client.get('/api/v1/generation/assets').json()] == ['Al_ice_S1AM'], 'folders without game_manifest are not listed'
    assert client.get('/api/v1/generation/assets/Al_ice_S1AM/sheets/02_Idle.png').content == b'png'
    assert client.get('/api/v1/generation/assets/..%2F..%2Fsecret/sheets/02_Idle.png').status_code == 404
    assert client.get('/api/v1/generation/assets/.hidden').status_code == 404
    assert client.post('/api/v1/generation', json={'name': 'Alice', 'template': 2, 'photo': 'bad'}).status_code == 400


def test_ui_workflow_omits_missing_widget_values(client, monkeypatch, tmp_path):
    workflow = deepcopy(UI_WORKFLOW)
    workflow['nodes'][0].pop('inputs')
    workflow['nodes'][0]['widgets_values'] = [1]
    workflow['nodes'].append({
        'id': 12, 'type': 'TaskforceReassembleAlignedSheets',
        'inputs': [{'name': 'images', 'widget': {'name': 'images'}, 'type': 'IMAGE', 'link': 3}] + [
            {'name': name, 'widget': {'name': name}, 'type': 'STRING', 'link': None}
            for name in ('pipeline_name', 'stabilize_scale', 'scale_match_strength', 'max_scale_adjust_percent')
        ] + [{'name': 'wait_for', 'widget': {'name': 'wait_for'}, 'type': '*', 'link': None}],
        'widgets_values': ['pipeline'],
    })
    calls = fake_comfy(monkeypatch, tmp_path, workflow)
    result = client.post('/api/v1/generation', json={'name': 'HL', 'template': 3, 'photo': PHOTO})
    assert result.status_code == 200
    submitted = calls[1][1]['json']['prompt']
    assert submitted['1']['inputs'] == {'value': 3}
    assert submitted['12']['inputs'] == {'pipeline_name': 'pipeline', 'images': ['3', 0]}
    assert generation.jobs[result.json()['job']][1] == 'HL_S1AM'


def test_api_format_workflow_is_submitted_as_is(client, monkeypatch, tmp_path):
    workflow = {'1': {'class_type': 'PrimitiveInt', 'inputs': {'value': 1}}, '2': {'class_type': 'String', 'inputs': {'String': 'x'}}, '3': {'class_type': 'LoadImage', 'inputs': {'image': 'a.jpg'}}, '4': {'class_type': 'TaskforceCharacterSlotSelector', 'inputs': {'slot_2_name': 'S2AM'}}}
    calls = fake_comfy(monkeypatch, tmp_path, workflow)
    assert client.post('/api/v1/generation', json={'name': 'Bo', 'template': 2, 'photo': PHOTO}).status_code == 200
    submitted = calls[1][1]['json']['prompt']
    assert [submitted[node]['inputs'] for node in '1234'] == [{'value': 2}, {'String': 'Bo'}, {'image': 'photo.jpg'}, {'slot_2_name': 'S2AM'}]


def test_art_machine_slot_paths_map_to_local_comfy_input(client, monkeypatch, tmp_path):
    art = r'C:\Users\Artist\Desktop\Taskforce 2028\Fight\Assets'
    motion = r'\Motion_Reference\{}\og_clip\sheets'
    workflow = {'1': {'class_type': 'PrimitiveInt', 'inputs': {'value': 1}}, '2': {'class_type': 'String', 'inputs': {'String': 'x'}}, '3': {'class_type': 'LoadImage', 'inputs': {'image': 'a.jpg'}}, '4': {'class_type': 'TaskforceCharacterSlotSelector', 'inputs': {
        'slot_2_name': 'S2AM', 'slot_2_template_image': art + r'\Character\S2AM\S2AM_Template.png', 'slot_2_motion_folder': art + motion.format('S2AM'), 'slot_2_reference_report': art + motion.format('S2AM') + r'\sprite_sheet_report.json',
        'slot_3_name': 'S1AM', 'slot_3_motion_folder': art + motion.format('S1LM'), 'output_root': 'taskforce_2028_ftg'}}}
    calls = fake_comfy(monkeypatch, tmp_path, workflow)
    monkeypatch.setattr(generation, 'INPUT', tmp_path)
    for name in ('S2AM', 'S1AM'):
        (tmp_path / 'taskforce_2028_ftg' / 'Motion_Reference' / name / 'og_clip' / 'sheets').mkdir(parents=True)
    assert client.post('/api/v1/generation', json={'name': 'Bo', 'template': 2, 'photo': PHOTO}).status_code == 200
    assert calls[1][1]['json']['prompt']['4']['inputs'] == {
        'slot_2_name': 'S2AM', 'slot_2_template_image': 'taskforce_2028_ftg/Character/S2AM_Template.png',
        'slot_2_motion_folder': 'taskforce_2028_ftg/Motion_Reference/S2AM/og_clip/sheets', 'slot_2_reference_report': 'taskforce_2028_ftg/Motion_Reference/S2AM/og_clip/sheets/sprite_sheet_report.json',
        'slot_3_name': 'S1AM', 'slot_3_motion_folder': 'taskforce_2028_ftg/Motion_Reference/S1AM/og_clip/sheets', 'output_root': 'taskforce_2028_ftg',
    }, 'missing local S1LM motion falls back to the slot name'


def test_cancel_interrupts_only_the_running_prompt_and_dequeues_it(client, monkeypatch, tmp_path):
    calls = fake_comfy(monkeypatch, tmp_path, UI_WORKFLOW)
    running = {'queue_running': [[1, 'prompt-1', {}]]}
    original_get = generation.httpx.AsyncClient.get

    async def get(self, path): return type('R', (), {'json': lambda s: running})() if path == '/queue' else await original_get(self, path)
    monkeypatch.setattr(generation.httpx.AsyncClient, 'get', get)
    job = client.post('/api/v1/generation', json={'name': 'Al', 'template': 3, 'photo': PHOTO}).json()['job']
    calls.clear()
    assert client.delete('/api/v1/generation/' + job).status_code == 204
    assert [path for path, _ in calls] == ['/interrupt', '/queue'], 'running prompt is interrupted then removed'
    assert calls[1][1]['json'] == {'delete': ['prompt-1']}
    calls.clear()
    assert client.delete('/api/v1/generation/' + job).status_code == 204 and not calls, 'unknown job is a no-op'
    running['queue_running'] = [[1, 'someone-else', {}]]
    job = client.post('/api/v1/generation', json={'name': 'Al', 'template': 3, 'photo': PHOTO}).json()['job']
    calls.clear()
    client.delete('/api/v1/generation/' + job)
    assert [path for path, _ in calls] == ['/queue'], "another player's running job is never interrupted"


def test_completed_generation_with_missing_assets_fails_permanently(client, monkeypatch, tmp_path):
    fake_comfy(monkeypatch, tmp_path, UI_WORKFLOW)
    job = client.post('/api/v1/generation', json={'name': 'Missing', 'template': 3, 'photo': PHOTO}).json()['job']
    response = client.get('/api/v1/generation/' + job)
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'GENERATION_ASSET_INVALID'


def test_delete_removes_only_a_generated_character_folder(client, monkeypatch, tmp_path):
    monkeypatch.setattr(generation, 'OUTPUT', tmp_path)
    root = tmp_path / 'taskforce_2028_ftg'
    write_output(root / 'Old_S1AW', 'Old', [action('02', 'Idle')])
    write_output(root / 'Keep_S2AM', 'Keep', [action('02', 'Idle')])
    (root / 'not_a_character').mkdir()
    (root / 'not_a_character' / 'notes.txt').write_text('x', encoding='utf-8')

    assert client.delete('/api/v1/generation/assets/Old_S1AW').status_code == 204
    assert not (root / 'Old_S1AW').exists()
    assert [asset['id'] for asset in client.get('/api/v1/generation/assets').json()] == ['Keep_S2AM']
    assert client.delete('/api/v1/generation/assets/Old_S1AW').status_code == 404, 'already deleted'
    assert client.delete('/api/v1/generation/assets/not_a_character').status_code == 404, 'folders without game_manifest are never removed'
    assert (root / 'not_a_character' / 'notes.txt').exists()
    assert client.delete('/api/v1/generation/assets/..%2F..%2Fsecret').status_code == 404
    assert client.delete('/api/v1/generation/assets/.hidden').status_code == 404


def test_clear_moves_every_generated_character_out_of_the_roster_and_keeps_other_output(client, monkeypatch, tmp_path):
    monkeypatch.setattr(generation, 'OUTPUT', tmp_path)
    root = tmp_path / 'taskforce_2028_ftg'
    write_output(root / 'One_S1AW', 'One', [action('02', 'Idle')])
    write_output(root / 'Two_S2AM', 'Two', [action('02', 'Idle')])
    (root / 'not_a_character').mkdir()

    assert client.delete('/api/v1/generation/assets').status_code == 204
    assert client.get('/api/v1/generation/assets').json() == []
    assert (root / 'not_a_character').exists()
    archived = sorted(p.parent.parent.name for p in (tmp_path / 'taskforce_2028_ftg_cleared').glob('*/*/manifest/game_manifest.json'))
    assert archived == ['One_S1AW', 'Two_S2AM'], 'cleared players are archived, not destroyed'
    assert client.delete('/api/v1/generation/assets').status_code == 204, 'clearing an empty roster is a no-op'


def test_roster_slots_fill_16_to_30_then_wrap_to_16_and_stay_put(client, monkeypatch, tmp_path):
    import os
    monkeypatch.setattr(generation, 'OUTPUT', tmp_path)
    root = tmp_path / 'taskforce_2028_ftg'

    def add(name, at):
        write_output(root / name, name, [action('02', 'Idle')])
        os.utime(root / name / 'manifest' / 'game_manifest.json', (at, at))

    def slots():
        return {asset['id']: asset['slot'] for asset in client.get('/api/v1/generation/assets').json()}

    for i in range(37):
        add(f'Old{i:02d}_S2AM', 1000 + i)
    first = slots()
    assert first['Old36_S2AM'] == 16, 'existing roster: the newest lands on 16, as if it arrived when 16–30 were full'
    assert [first[f'Old{i:02d}_S2AM'] for i in range(22, 36)] == list(range(17, 31))
    assert len(first) == 15, 'older players stay in the archive of output folders but leave the roster'

    add('New1_S2AM', 2000)
    after = slots()
    assert after['New1_S2AM'] == 17 and 'Old22_S2AM' not in after, 'next player overwrites the oldest, slot 17'
    assert all(after[k] == v for k, v in first.items() if k != 'Old22_S2AM'), 'nobody else moves'

    for i in range(2, 15):
        add(f'New{i}_S2AM', 2000 + i)
    assert slots()['New14_S2AM'] == 30
    add('New15_S2AM', 3000)
    assert slots()['New15_S2AM'] == 16, 'after 30 the next player goes back to 16'

    add('New3_S2AM', 4000)
    assert slots()['New3_S2AM'] == 19, 'regenerating a player in the roster keeps their slot'

    assert client.delete('/api/v1/generation/assets/New5_S2AM').status_code == 204
    add('Hole_S2AM', 5000)
    assert slots()['Hole_S2AM'] == 21, 'a deleted player leaves a hole that the next player fills'

    assert client.delete('/api/v1/generation/assets').status_code == 204
    add('Fresh1_S2AM', 6000); add('Fresh2_S2AM', 6001)
    assert slots() == {'Fresh1_S2AM': 16, 'Fresh2_S2AM': 17}, 'after clearing, players fill from 16 again'


def test_thumb_is_the_first_idle_cell_scaled_to_256(client, monkeypatch, tmp_path):
    from io import BytesIO
    from PIL import Image

    monkeypatch.setattr(generation, 'OUTPUT', tmp_path)
    folder = tmp_path / 'taskforce_2028_ftg' / 'Al_S1AW'
    write_output(folder, 'Al', [action('02', 'Idle')])
    sheet = Image.new('RGBA', (4096, 2048))
    sheet.paste((255, 0, 0, 255), (0, 0, 1024, 1024))
    sheet.save(folder / 'Sprite_Sheet_reference_aligned' / '02_Idle.png')

    response = client.get('/api/v1/generation/assets/Al_S1AW/thumb.png')
    assert response.status_code == 200 and response.headers['content-type'] == 'image/png'
    thumb = Image.open(BytesIO(response.content))
    assert thumb.size == (256, 256)
    assert thumb.getpixel((128, 128)) == (255, 0, 0, 255), 'only frame 0 of the idle sheet'
    assert client.get('/api/v1/generation/assets/Missing_S1AW/thumb.png').status_code == 404
