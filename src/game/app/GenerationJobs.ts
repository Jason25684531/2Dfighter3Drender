import type Phaser from 'phaser'
import type { PlayerSlotId } from '../input/InputManager'
import type { CharacterEntry } from '../ui/assets/TestAssetManifest'
import { dropGeneratedTextures, generateCharacter, listGeneratedCharacters, loadGeneratedCharacter } from '../api/CharacterGeneration'

/** P3 載入畫面在生成期間顯示的拍照頭像。 */
export const faceKey = (id: PlayerSlotId): string => `face-${id}`

type Job = { name: string; template: number; photo: string; state: 'processing' | 'ready' | 'failed'; controller: AbortController; assetId?: string }

/** P1 拍照生成到 P3 載入之間的生成工作、已生成名冊與素材載入狀態；回到 P0／P1 時整批清除。 */
export class GenerationJobs {
  entries: CharacterEntry[] = []
  entriesReady = false
  assets: 'idle' | 'loading' | 'ready' | 'failed' = 'idle'
  private jobs: Partial<Record<PlayerSlotId, Job>> = {}
  private readonly loads = new Map<string, Promise<void>>()

  /** onReady：生成完成、名冊已加入新角色後呼叫，generatedId 為 `generated-<assetId>`。 */
  constructor(private readonly scene: Phaser.Scene, private readonly onReady: (owner: PlayerSlotId, generatedId: string, template: number) => void) {}

  has(owner: PlayerSlotId): boolean { return Boolean(this.jobs[owner]) }
  assetId(owner: PlayerSlotId): string | undefined { return this.jobs[owner]?.assetId }
  get generating(): boolean { return Object.values(this.jobs).some((job) => job.state === 'processing') }
  get failed(): boolean { return Object.values(this.jobs).some((job) => job.state === 'failed') }

  async refreshEntries(): Promise<void> {
    this.entriesReady = false
    this.entries = await listGeneratedCharacters()
    this.entriesReady = true
  }

  start(owner: PlayerSlotId, name: string, template: number, photo: string): void {
    this.jobs[owner]?.controller.abort()
    const job: Job = { name, template, photo, state: 'processing', controller: new AbortController() }
    this.jobs[owner] = job
    void generateCharacter(this.scene, name, template, photo, job.controller.signal).then((assetId) => {
      if (this.jobs[owner] !== job) return
      job.assetId = assetId; job.state = 'ready'
      const id = `generated-${assetId}` as const
      if (!this.entries.some((entry) => entry.id === id)) this.entries.push({ id, generationId: assetId, displayName: name, type: 'CUSTOM', status: 'READY', spriteId: id })
      this.onReady(owner, id, template)
    }, () => { if (!job.controller.signal.aborted) job.state = 'failed' })
  }

  cancel(owner: PlayerSlotId): void { this.jobs[owner]?.controller.abort(); delete this.jobs[owner] }

  load(assetId: string, idleOnly = false): Promise<void> {
    const key = `${assetId}:${idleOnly}`, current = this.loads.get(key)
    if (current) return current
    const loading = loadGeneratedCharacter(this.scene, assetId, new AbortController().signal, idleOnly)
    this.loads.set(key, loading)
    void loading.finally(() => this.loads.delete(key)).catch(() => undefined)
    return loading
  }

  /** 進 P2 前載入雙方選定的已生成角色完整圖集；characterIds 中非 `generated-` 的會略過。 */
  loadSelected(characterIds: Array<string | undefined>): void {
    const ids = characterIds.filter((id): id is string => Boolean(id?.startsWith('generated-'))).map((id) => id.slice('generated-'.length))
    if (!ids.length) { this.assets = 'ready'; return }
    this.assets = 'loading'
    void Promise.all(ids.map((id) => this.load(id))).then(() => { this.assets = 'ready' }, () => { this.assets = 'failed' })
  }

  /** P3 重試：重新送出失敗的生成；素材載入失敗則重新載入。回傳 true 表示有東西正在重試。 */
  retry(characterIds: Array<string | undefined>): boolean {
    const failed = (Object.entries(this.jobs) as Array<[PlayerSlotId, Job]>).filter(([, job]) => job.state === 'failed')
    failed.forEach(([owner, { name, template, photo }]) => this.start(owner, name, template, photo))
    if (this.assets === 'failed') { this.loadSelected(characterIds); return true }
    return failed.length > 0
  }

  clear(): void {
    Object.values(this.jobs).forEach((job) => job.controller.abort())
    this.jobs = {}
    dropGeneratedTextures(this.scene)
    this.loads.clear(); this.assets = 'idle'
  }
}
