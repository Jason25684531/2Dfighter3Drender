import sqlite3
from contextlib import contextmanager
from pathlib import Path


def connect(db_path: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys = ON')
    return connection


def init_db(db_path: str | Path) -> None:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as connection:
        connection.executescript((Path(__file__).parent / 'schema.sql').read_text(encoding='utf-8'))
        with transaction(connection):
            columns = {row['name'] for row in connection.execute('PRAGMA table_info(matches)')}
            if 'difficulty' not in columns:
                connection.execute("ALTER TABLE matches ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'NORMAL'")


@contextmanager
def transaction(connection: sqlite3.Connection):
    connection.execute('BEGIN IMMEDIATE')
    try:
        yield connection
    except Exception:
        connection.rollback()
        raise
    else:
        connection.commit()
