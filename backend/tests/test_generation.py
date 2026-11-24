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
