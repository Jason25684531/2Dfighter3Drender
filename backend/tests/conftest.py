import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / 'exp2-test.db'


@pytest.fixture
def client(db_path: Path):
    with TestClient(create_app(db_path)) as test_client:
        yield test_client
