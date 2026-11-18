import base64
import binascii
import json
import os
import re
import shutil
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
ASSET_ID = re.compile(r'[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?')
# Node ids per docs/Taskforce 2028 FTG_README_交接說明.md.
TEMPLATE, NAME, PHOTO, SELECTOR = '1', '2', '3', '4'
jobs: dict[str, tuple[str, str]] = {}


class GenerationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=16)
    template: int = Field(ge=1, le=4)
    photo: str = Field(max_length=8_000_000)


def safe_name(name: str) -> str:
    """Mirrors TaskforceCharacterSlotSelector._safe_filename so the folder name can be predicted."""
    return re.sub(r'_+', '_', re.sub(r'[^A-Za-z0-9._-]+', '_', name.strip())).strip('._-') or 'action'


def api_prompt(workflow: dict) -> dict:
    """Converts a ComfyUI UI-format save (nodes + links) to the /prompt format; API-format files pass through."""
    if 'nodes' not in workflow:
        return workflow
    # ponytail: no bypassed/muted nodes, Reroutes or frontend-only Primitive nodes; add when the art team's workflow uses them.
    sources = {link[0]: [str(link[1]), link[2]] for link in workflow['links']}
    prompt = {}
    for node in workflow['nodes']:
        values, index, inputs = node.get('widgets_values') or [], 0, {}
        for slot in node.get('inputs', []):
            if 'widget' in slot:
                inputs[slot['name']] = values[index]
                index += 1
                if slot['type'] == 'INT' and index < len(values) and values[index] in ('fixed', 'increment', 'decrement', 'randomize'):
                    index += 1
            if slot.get('link') is not None:
                inputs[slot['name']] = sources[slot['link']]
        prompt[str(node['id'])] = {'class_type': node['type'], 'inputs': inputs}
    return prompt


def asset_folder(asset_id: str) -> Path:
    """The workflow writes <output>/taskforce_2028_ftg/<name>_<template>/; that folder name is the asset id."""
    if not ASSET_ID.fullmatch(asset_id):
        raise ApiError('NOT_FOUND', 404, 'Character asset not found')
    return OUTPUT / 'taskforce_2028_ftg' / asset_id


def read_asset(asset_id: str) -> dict:
    folder = asset_folder(asset_id)
    manifest = json.loads((folder / 'manifest' / 'game_manifest.json').read_text(encoding='utf-8'))
    if manifest['cell_width'] != manifest['cell_height']:
        raise ValueError('Frontend slices square cells')
    actions = {}
    for entry in manifest['actions']:
        filename = Path(entry['sprite_sheet']).name
        if not (folder / 'Sprite_Sheet_reference_aligned' / filename).is_file():
            raise ValueError('Missing sheet')
        actions[entry['id']] = {'filename': filename, 'frames': entry['frame_count'], 'cellSize': manifest['cell_width']}
    if not actions:
        raise ValueError('Empty manifest')
    return {'id': asset_id, 'displayName': manifest['user_name'], 'fps': manifest.get('gif_fps', 16), 'actions': actions}


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
        workflow = api_prompt(json.loads(WORKFLOW.read_text(encoding='utf-8')))
        job = uuid4().hex
        workflow[TEMPLATE]['inputs']['value'] = request.template
        workflow[NAME]['inputs']['String'] = request.name.strip()
        async with httpx.AsyncClient(base_url=COMFY, timeout=30) as client:
            upload = await client.post('/upload/image', files={'image': (f'{job}.jpg', photo, 'image/jpeg')}, data={'type': 'input', 'overwrite': 'false'})
            upload.raise_for_status()
            workflow[PHOTO]['inputs']['image'] = upload.json()['name']
            submitted = await client.post('/prompt', json={'prompt': workflow, 'client_id': job})
            submitted.raise_for_status()
            prompt_id = submitted.json()['prompt_id']
        # ponytail: same name + template reuses (and the workflow clears) one folder; per-run folders if two players may share both at once.
        jobs[job] = (prompt_id, safe_name(request.name) + '_' + safe_name(workflow[SELECTOR]['inputs'][f'slot_{request.template}_name']))
        return {'job': job}
    except (OSError, LookupError, ValueError, httpx.HTTPError) as error:
        raise ApiError('GENERATION_UNAVAILABLE', 502, 'ComfyUI submission failed') from error


@router.get('/generation/assets')
def generation_assets():
    assets = []
    for manifest in (OUTPUT / 'taskforce_2028_ftg').glob('*/manifest/game_manifest.json'):
        try:
            asset = read_asset(manifest.parent.parent.name)
            asset['updated'] = manifest.stat().st_mtime
            assets.append(asset)
        except (ApiError, OSError, ValueError, KeyError, TypeError):
            continue
    return sorted(assets, key=lambda asset: (asset['updated'], asset['id']))


@router.get('/generation/assets/{asset_id}')
def generation_asset(asset_id: str):
    try:
        return read_asset(asset_id)
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise ApiError('NOT_FOUND', 404, 'Character asset not found') from error


@router.delete('/generation/assets/{asset_id}', status_code=204)
def delete_generation_asset(asset_id: str):
    """Removes one generated character folder. Only folders that hold a game_manifest are touched, so other output stays safe."""
    folder = asset_folder(asset_id)
    if not (folder / 'manifest' / 'game_manifest.json').is_file():
        raise ApiError('NOT_FOUND', 404, 'Character asset not found')
    # ponytail: does not check for a still-running generation into this folder; ComfyUI recreates it if one finishes later.
    shutil.rmtree(folder)


@router.get('/generation/assets/{asset_id}/sheets/{filename}')
def generation_sheet(asset_id: str, filename: str):
    path = asset_folder(asset_id) / 'Sprite_Sheet_reference_aligned' / filename
    if not re.fullmatch(r'[A-Za-z0-9_]+\.png', filename) or not path.is_file():
        raise ApiError('NOT_FOUND', 404, 'Sheet not found')
    return FileResponse(path, media_type='image/png')


@router.delete('/generation/{job}', status_code=204)
async def cancel_generation(job: str):
    """Drops an abandoned job from ComfyUI so a retry does not queue behind (or race) the stale prompt. Best effort: ComfyUI may be frozen."""
    entry = jobs.pop(job, None)
    if not entry:
        return
    prompt_id = entry[0]
    try:
        async with httpx.AsyncClient(base_url=COMFY, timeout=5) as client:
            queue = (await client.get('/queue')).json()
            # /interrupt stops whatever runs now, so only call it when that is this job's prompt.
            if any(item[1] == prompt_id for item in queue.get('queue_running', [])):
                await client.post('/interrupt')
            await client.post('/queue', json={'delete': [prompt_id]})
    except (KeyError, IndexError, ValueError, httpx.HTTPError):
        pass


@router.get('/generation/{job}')
async def generation_status(job: str):
    if job not in jobs:
        raise ApiError('NOT_FOUND', 404, 'Generation job not found')
    prompt_id, asset_id = jobs[job]
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
        return {'status': 'ready', **read_asset(asset_id)}
    except (OSError, KeyError, ValueError, httpx.HTTPError) as error:
        raise ApiError('GENERATION_UNAVAILABLE', 502, 'ComfyUI result unavailable') from error
