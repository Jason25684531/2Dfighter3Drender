import base64
import binascii
import json
import os
import re
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi import APIRouter
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.errors import ApiError

router = APIRouter()
WORKFLOW = Path(__file__).resolve().parents[3] / 'ComfyUI_API' / 'CAMCharacter_Swa__1112(API).json'
OUTPUT = Path(os.getenv('COMFYUI_OUTPUT', r'C:\ComfyUI_windows_portable_260701\ComfyUI\output'))
COMFY = os.getenv('COMFYUI_URL', 'http://127.0.0.1:8188').rstrip('/')
jobs: dict[str, tuple[str, Path]] = {}


class GenerationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=16)
    template: int = Field(ge=1, le=4)
    photo: str = Field(max_length=8_000_000)


def safe_name(name: str) -> str:
    return re.sub(r'_+', '_', re.sub(r'[^A-Za-z0-9._-]+', '_', name.strip())).strip('._-') or 'action'


def read_asset(job: str, folder: Path) -> dict:
    manifest = json.loads((folder / 'reference_aligned_manifest.json').read_text(encoding='utf-8'))
    actions = {}
    for action, entry in manifest['actions'].items():
        filename = Path(entry['sprite_sheet']).name
        if not (folder / 'Sprite_Sheet_reference_aligned' / filename).is_file():
            raise ValueError('Missing sheet')
        actions[action] = {'filename': filename, 'frames': entry['frame_count'], 'cellSize': manifest['cell_size']}
    if not actions:
        raise ValueError('Empty manifest')
    name = folder.name.rsplit('_', 1)[0]
    return {'id': job, 'displayName': name, 'actions': actions}


def asset_folder(job: str) -> Path:
    if not re.fullmatch(r'[0-9a-f]{32}', job):
        raise ApiError('NOT_FOUND', 404, 'Character asset not found')
    matches = list((OUTPUT / 'taskforce_2028_ftg' / '_jobs' / job).glob('*/reference_aligned_manifest.json'))
    if len(matches) != 1:
        raise ApiError('NOT_FOUND', 404, 'Character asset not found')
    return matches[0].parent


@router.post('/generation')
async def submit_generation(request: GenerationRequest):
    if not request.name.strip():
        raise ApiError('INVALID_NAME', 400, 'Player name is required')
    try:
        prefix, data = request.photo.split(',', 1)
        if prefix != 'data:image/jpeg;base64':
            raise ValueError('Expected JPEG')
        photo = base64.b64decode(data, validate=True)
        if not photo.startswith(b'\xff\xd8\xff') or len(photo) > 5_000_000:
            raise ValueError('Invalid JPEG')
    except (ValueError, binascii.Error) as error:
        raise ApiError('INVALID_PHOTO', 400, 'Invalid JPEG photo') from error

    try:
        workflow = json.loads(WORKFLOW.read_text(encoding='utf-8'))
        job = uuid4().hex
        workflow['2']['inputs']['value'] = request.template
        workflow['13']['inputs']['value'] = request.name.strip()
        # The workflow clears its output directory; isolate every run from existing characters.
        workflow['4']['inputs']['output_root'] = f'taskforce_2028_ftg/_jobs/{job}'
        async with httpx.AsyncClient(base_url=COMFY, timeout=30) as client:
            upload = await client.post('/upload/image', files={'image': (f'{job}.jpg', photo, 'image/jpeg')}, data={'type': 'input', 'overwrite': 'false'})
            upload.raise_for_status()
            workflow['3']['inputs']['image'] = upload.json()['name']
            submitted = await client.post('/prompt', json={'prompt': workflow, 'client_id': job})
            submitted.raise_for_status()
            prompt_id = submitted.json()['prompt_id']
        character = safe_name(request.name) + '_' + safe_name(workflow['4']['inputs'][f'slot_{request.template}_name'])
        folder = OUTPUT / 'taskforce_2028_ftg' / '_jobs' / job / character
        jobs[job] = (prompt_id, folder)
        return {'job': job}
    except (OSError, KeyError, ValueError, httpx.HTTPError) as error:
        raise ApiError('GENERATION_UNAVAILABLE', 502, 'ComfyUI submission failed') from error


@router.get('/generation/assets')
def generation_assets():
    root = OUTPUT / 'taskforce_2028_ftg' / '_jobs'
    if not root.is_dir():
        return []
    assets = []
    for manifest in root.glob('*/*/reference_aligned_manifest.json'):
        job, folder = manifest.parent.parent.name, manifest.parent
        try:
            if not re.fullmatch(r'[0-9a-f]{32}', job):
                continue
            asset = read_asset(job, folder)
            asset['updated'] = manifest.stat().st_mtime
            assets.append(asset)
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return sorted(assets, key=lambda asset: (asset['updated'], asset['id']))


@router.get('/generation/assets/{asset_id}')
def generation_asset(asset_id: str):
    try:
        return read_asset(asset_id, asset_folder(asset_id))
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise ApiError('NOT_FOUND', 404, 'Character asset not found') from error


@router.get('/generation/{job}')
async def generation_status(job: str):
    if job not in jobs:
        raise ApiError('NOT_FOUND', 404, 'Generation job not found')
    prompt_id, folder = jobs[job]
    try:
        async with httpx.AsyncClient(base_url=COMFY, timeout=10) as client:
            response = await client.get(f'/history/{prompt_id}')
            response.raise_for_status()
            history = response.json().get(prompt_id)
        if not history:
            return {'status': 'processing'}
        status = history.get('status', {})
        if status.get('status_str') == 'error':
            return {'status': 'failed'}
        if not status.get('completed'):
            return {'status': 'processing'}
        return {'status': 'ready', **read_asset(job, folder)}
    except (OSError, KeyError, ValueError, httpx.HTTPError) as error:
        raise ApiError('GENERATION_UNAVAILABLE', 502, 'ComfyUI result unavailable') from error


@router.get('/generation/{job}/sheets/{filename}')
def generation_sheet(job: str, filename: str):
    if not re.fullmatch(r'[0-9a-f]{32}', job) or Path(filename).name != filename or not re.fullmatch(r'[A-Za-z0-9_]+\.png', filename):
        raise ApiError('NOT_FOUND', 404, 'Sheet not found')
    if job in jobs:
        folder = jobs[job][1]
    else:
        folder = asset_folder(job)
    path = folder / 'Sprite_Sheet_reference_aligned' / filename
    if not path.is_file():
        raise ApiError('NOT_FOUND', 404, 'Sheet not found')
    return FileResponse(path, media_type='image/png')
