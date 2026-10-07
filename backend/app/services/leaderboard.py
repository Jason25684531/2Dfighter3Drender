import sqlite3


ORDER = 'score DESC, remaining_hp DESC, max_combo DESC, finished_at ASC, id ASC'


def refresh_ranks(connection: sqlite3.Connection) -> None:
    connection.execute('UPDATE matches SET rank = NULL')
    connection.execute(f'''WITH best AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY {ORDER}) AS within_session
      FROM matches WHERE status = 'FINISHED'
    ), ranked AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY {ORDER}) AS rank FROM matches WHERE id IN (SELECT id FROM best WHERE within_session = 1)
    ) UPDATE matches SET rank = (SELECT rank FROM ranked WHERE ranked.id = matches.id) WHERE id IN (SELECT id FROM ranked)''')


def entries(connection: sqlite3.Connection, limit: int) -> list[dict]:
    return [dict(row) for row in connection.execute('''SELECT m.rank, m.id AS match_id, m.session_id, p.nickname, m.score, m.title, m.remaining_hp, m.max_combo, m.finished_at
      FROM matches m JOIN sessions s ON s.id=m.session_id JOIN players p ON p.id=s.player_id
      WHERE m.status='FINISHED' AND m.rank IS NOT NULL ORDER BY m.rank LIMIT ?''', (limit,))]
