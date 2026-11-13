import base64
import json

from app.routes import generation


def test_generation_injects_workflow_and_isolates_outputs(client, monkeypatch, tmp_path):
    workflow = {'2': {'inputs': {}}, '3': {'inputs': {}}, '4': {'inputs': {'slot_2_name': 'S2AM'}}, '13': {'inputs': {}}}
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
    photo = 'data:image/jpeg;base64,' + base64.b64encode(b'\xff\xd8\xfftest').decode()
    result = client.post('/api/v1/generation', json={'name': 'Alice', 'template': 2, 'photo': photo})
    assert result.status_code == 200
    job = result.json()['job']
    submitted = calls[1][1]['json']['prompt']
    assert submitted['2']['inputs']['value'] == 2
    assert submitted['3']['inputs']['image'] == 'photo.jpg'
    assert submitted['13']['inputs']['value'] == 'Alice'
    assert submitted['4']['inputs']['output_root'].endswith(job)
    folder = tmp_path / 'taskforce_2028_ftg' / '_jobs' / job / 'Alice_S2AM'
    sheet = folder / 'Sprite_Sheet_reference_aligned' / '02_Idle.png'
    sheet.parent.mkdir(parents=True)
    sheet.write_bytes(b'png')
    (folder / 'reference_aligned_manifest.json').write_text(json.dumps({'cell_size': 1024, 'actions': {'02_Idle': {'sprite_sheet': str(sheet), 'frame_count': 8}}}), encoding='utf-8')
    assert client.get('/api/v1/generation/' + job).json()['actions']['02_Idle']['frames'] == 8
    assert client.get(f'/api/v1/generation/{job}/sheets/02_Idle.png').content == b'png'
    assert client.post('/api/v1/generation', json={'name': 'Alice', 'template': 2, 'photo': 'bad'}).status_code == 400
