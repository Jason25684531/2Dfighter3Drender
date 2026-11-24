"""Live integration smoke check; requires the isolated backend used by browser verification."""
import base64
import io
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

OUT = Path('outputs/aligned-character-verification')
OUT.mkdir(parents=True, exist_ok=True)
API = os.getenv('COMFY_SMOKE_API', 'http://127.0.0.1:19881/api/v1')
COMFY = 'http://127.0.0.1:8188'
COMFY_OUTPUT = Path(r'C:\ComfyUI_windows_portable_260701\ComfyUI\output\taskforce_2028_ftg')


def request(url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}), timeout=40) as response:
        return json.load(response)


report = {'service': False, 'workflowNodesAvailable': False, 'submitted': False, 'status': None}
try:
    stats = request(COMFY + '/system_stats')
    report['service'] = True
    report['version'] = stats['system'].get('comfyui_version')
    nodes = request(COMFY + '/object_info')
    workflow = json.loads(Path('ComfyUI_API/2026_Taskforce_2028_FTG_Final_CAM_261115.json').read_text(encoding='utf-8'))
    types = {node['type'] for node in workflow['nodes']} if 'nodes' in workflow else {node['class_type'] for node in workflow.values()}
    report['missingNodes'] = sorted(types - nodes.keys())
    report['workflowNodesAvailable'] = not report['missingNodes']
    # Synthetic, non-personal JPEG exercises upload/submission without using a visitor photo.
    image = Image.new('RGB', (512, 512), (130, 130, 130))
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG')
    job = request(API + '/generation', {'name': os.getenv('COMFY_SMOKE_NAME', 'AlignedSmoke'), 'template': 1, 'photo': 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode()})['job']
    report.update(submitted=True, job=job)
    print('Submitted live generation', job, flush=True)
    for _ in range(200):
        status = request(API + '/generation/' + job)
        report['status'] = status['status']
        if status['status'] != 'processing':
            if status['status'] == 'ready':
                report.update(assetId=status['id'], actions=status['actions'], downloadedSheets=0)
                folder = COMFY_OUTPUT / status['id'] / 'Sprite_Sheet_reference_aligned'
                report['nativeFolder'] = str(folder)
                assert all((folder / sheet['filename']).is_file() for sheet in status['actions'].values()), 'sheets missing from native output folder'
                for sheet in status['actions'].values():
                    with urllib.request.urlopen(API + f"/generation/assets/{status['id']}/sheets/" + sheet['filename'], timeout=30) as response:
                        assert response.read(8) == b'\x89PNG\r\n\x1a\n'
                        report['downloadedSheets'] += 1
            break
        time.sleep(3)
    if report['status'] == 'processing':
        report['limitation'] = 'Still processing after 10 minutes; generation completion is unverified.'
    if report['status'] == 'failed':
        history = request(COMFY + '/history')
        for entry in history.values():
            prompt = entry.get('prompt', [])
            if job not in json.dumps(prompt):
                continue
            report['executionErrors'] = [{'nodeType': event[1].get('node_type'), 'exceptionType': event[1].get('exception_type')} for event in entry.get('status', {}).get('messages', []) if event[0] == 'execution_error']
except urllib.error.HTTPError as error:
    report['httpError'] = error.code
    report['status'] = 'request_failed'
except Exception as error:
    report['errorType'] = type(error).__name__
finally:
    (OUT / 'comfy-live-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2), flush=True)

if report['status'] != 'ready' or report.get('downloadedSheets') != len(report.get('actions', {})):
    raise SystemExit(1)
