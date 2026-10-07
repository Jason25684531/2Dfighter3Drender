import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 18000 + Math.floor(Math.random() * 1000)
const directory = await mkdtemp(join(tmpdir(), 'exp2-system-'))
const dbPath = join(directory, 'exp2.db')
const python = process.platform === 'win32' ? 'venv\\Scripts\\python.exe' : 'venv/bin/python'
const baseUrl = `http://127.0.0.1:${port}/api/v1`
const startServer = () => spawn(python, ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', String(port)], { env: { ...process.env, EXP2_DB_PATH: dbPath }, stdio: 'ignore' })
const waitForHealth = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) return } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Backend did not start')
}
const stopServer = async (processHandle) => {
  if (processHandle.exitCode === null) await new Promise((resolve) => { processHandle.once('close', resolve); processHandle.kill() })
}
let server = startServer()
try {
  await waitForHealth()
  const vitest = process.platform === 'win32' ? 'node_modules\\.bin\\vitest.cmd' : 'node_modules/.bin/vitest'
  const result = await new Promise((resolve) => {
    const child = spawn(vitest, ['run', 'src/game/system'], { env: { ...process.env, VITE_SYSTEM_API_BASE_URL: baseUrl }, stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('exit', (code) => resolve(code ?? 1))
  })
  process.exitCode = result
  if (result === 0) {
    await stopServer(server)
    server = startServer()
    await waitForHealth()
    if (!(await fetch(`${baseUrl}/leaderboard`)).ok) throw new Error('Persisted database was not readable after backend restart')
  }
} finally {
  await stopServer(server)
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { await rm(directory, { recursive: true, force: true }); break } catch { await new Promise((resolve) => setTimeout(resolve, 100)) }
  }
}
