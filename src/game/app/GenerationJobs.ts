import type Phaser from 'phaser'
import type { PlayerSlotId } from '../input/InputManager'
import type { CharacterEntry } from '../ui/assets/TestAssetManifest'
import { dropGeneratedTextures, dropHdActions, generateCharacter, listGeneratedCharacters, loadGeneratedCharacter, loadHdSprite } from '../api/CharacterGeneration'
import { alignedSprites, type AlignedSpriteId } from '../ui/animation/SheetSpriteManifest'

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
  private assetController = new AbortController()
  private releaseAssets = () => {}
  private assetGate = new Promise<void>(resolve => { this.releaseAssets = resolve })

  /** onReady：生成完成、名冊已加入新角色後呼叫，generatedId 為 `generated-<assetId>`。 */
  constructor(private readonly scene: Phaser.Scene, private readonly onReady: (owner: PlayerSlotId, generatedId: `generated-${string}`, template: number) => void) {}

  has(owner: PlayerSlotId): boolean { return Boolean(this.jobs[owner]) }
  assetId(owner: PlayerSlotId): string | undefined { return this.jobs[owner]?.assetId }
  get generating(): boolean { return Object.values(this.jobs).some((job) => job.state === 'processing') }
  /** 已送出算圖且沒有失敗：之後不可回上一頁或主選單（UX v03 UC03-1／UC05-1）。失敗或素材載入失敗時放行，機台才不會卡死。 */
  get locked(): boolean { const jobs = Object.values(this.jobs); return jobs.length > 0 && this.assets !== 'failed' && jobs.every((job) => job.state !== 'failed') }
  get failed(): boolean { return Object.values(this.jobs).some((job) => job.state === 'failed') }
  get canSkip(): boolean { return this.failed && !this.generating && this.assets === 'ready' }

  async refreshEntries(): Promise<void> {
    this.entriesReady = false
    this.entries = await listGeneratedCharacters()
    this.entriesReady = true
  }

  start(owner: PlayerSlotId, name: string, template: number, photo: string): void {
    this.jobs[owner]?.controller.abort()
    const job: Job = { name, template, photo, state: 'processing', controller: new AbortController() }
    this.jobs[owner] = job
    void generateCharacter(this.scene, name, template, photo, job.controller.signal, this.assetGate).then((assetId) => {
      if (this.jobs[owner] !== job) return
      job.assetId = assetId; job.state = 'ready'
      const id = `generated-${assetId}` as const
      if (!this.entries.some((entry) => entry.id === id)) this.entries.push({ id, generationId: assetId, displayName: name, type: 'CUSTOM', status: 'READY', spriteId: id })
      this.onReady(owner, id, template)
    }, () => { if (!job.controller.signal.aborted) job.state = 'failed' })
  }

  cancel(owner: PlayerSlotId): void { this.jobs[owner]?.controller.abort(); delete this.jobs[owner] }

  skipFailed(): boolean {
    if (!this.canSkip) return false
    for (const owner of ['P1', 'P2'] as const) if (this.jobs[owner]?.state === 'failed') this.cancel(owner)
    return true
  }

  load(assetId: string, idleOnly = false): Promise<void> {
    const key = `${assetId}:${idleOnly}`, current = this.loads.get(key)
    if (current) return current
    const loading = loadGeneratedCharacter(this.scene, assetId, this.assetController.signal, idleOnly)
    this.loads.set(key, loading)
    void loading.finally(() => { if (this.loads.get(key) === loading) this.loads.delete(key) }).catch(() => undefined)
    return loading
  }

  /** P3 顯示後載入雙方完整圖集，也讓已生成的工作開始下載。 */
  async loadSelected(characterIds: Array<string | undefined>, sprites: Array<string | undefined> = []): Promise<boolean> {
    this.releaseAssets()
    const ids = new Set(characterIds.filter((id): id is string => Boolean(id?.startsWith('generated-'))).map((id) => id.slice('generated-'.length)))
    const roster = new Set(sprites.filter((id): id is AlignedSpriteId => Boolean(id && id in alignedSprites)))
    const { signal } = this.assetController
    this.assets = 'loading'
    try {
      for (const id of ids) { if (signal.aborted) return false; await this.load(id) }
      for (const id of roster) { if (signal.aborted) return false; await loadHdSprite(this.scene, id) }
      if (!signal.aborted) this.assets = 'ready'
    } catch {
      if (!signal.aborted) this.assets = 'failed'
    }
    return !signal.aborted
  }

  /** P3 重試：重新送出失敗的生成；素材載入失敗則重新載入。回傳 true 表示有東西正在重試。 */
  retry(characterIds: Array<string | undefined>, sprites: Array<string | undefined> = []): boolean {
    const failed = (Object.entries(this.jobs) as Array<[PlayerSlotId, Job]>).filter(([, job]) => job.state === 'failed')
    failed.forEach(([owner, { name, template, photo }]) => this.start(owner, name, template, photo))
    if (this.assets === 'failed') { this.loadSelected(characterIds, sprites); return true }
    return failed.length > 0
  }

  clear(): void {
    Object.values(this.jobs).forEach((job) => job.controller.abort())
    this.jobs = {}
    this.assetController.abort()
    this.assetController = new AbortController()
    this.releaseAssets()
    this.assetGate = new Promise<void>(resolve => { this.releaseAssets = resolve })
    dropGeneratedTextures(this.scene); dropHdActions(this.scene)
    this.loads.clear(); this.assets = 'idle'
  }
}
