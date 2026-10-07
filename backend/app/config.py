from dataclasses import dataclass
from os import getenv
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    db_path: Path
    cors_origins: tuple[str, ...]


def settings(db_path: str | Path | None = None) -> Settings:
    path = Path(db_path or getenv('EXP2_DB_PATH', 'backend/data/exp2.db'))
    origins = tuple(origin.strip() for origin in getenv('EXP2_CORS_ORIGINS', 'http://localhost:5173').split(',') if origin.strip())
    return Settings(path, origins)
