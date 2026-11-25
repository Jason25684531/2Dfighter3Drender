import Phaser from 'phaser'
import { stageTextureKey, testCharacterManifest, testStageManifest } from '../ui/assets/TestAssetManifest'
import { loadHdSprite, paintHdHead } from '../api/CharacterGeneration'
import type { AlignedSpriteId } from '../ui/animation/SheetSpriteManifest'
import { loadSheetSprites, registerSheetAnimations } from '../ui/animation/SheetSpriteManifest'
import { loadImpactFx, registerImpactFx } from '../ui/vfx/ImpactFx'
import { loadHomeAssets } from '../ui/screens/HomeScreen'
import { LAB_STAGE_DIR } from '../ui/stage/StageParallax'
import { GameAudio } from '../audio/GameAudio'
import layout from '../ui/assets/hudLayout.json'

const officers = Object.values(testCharacterManifest).map(({ spriteId }) => spriteId as AlignedSpriteId)
const hudFonts = import.meta.glob<string>('/public/fonts/{rog-fonts,trade-gothic-bdcn}.woff2', { eager: true, query: '?url', import: 'default' })

export class BootScene extends Phaser.Scene {
  protected readonly legacySheets: boolean = false
  constructor() {
    super('BootScene')
  }

  preload(): void {
    GameAudio.load(this)
    Object.values(testStageManifest).forEach((stage) => this.load.image(stageTextureKey(stage.id), stage.url))
    loadSheetSprites(this, this.legacySheets)
    loadImpactFx(this)
    loadHomeAssets(this)
    for (const [key, { url }] of Object.entries({ ...layout.hud, ...layout.select })) this.load.image(key, url)
    this.load.image('lab-poster', `${LAB_STAGE_DIR}/poster.jpg`)
    this.load.image('lab-foreground', `${LAB_STAGE_DIR}/foreground.png`)
  }

  async create(): Promise<void> {
    registerSheetAnimations(this); registerImpactFx(this)
    let timeout: ReturnType<typeof setTimeout> | undefined
    const faces = ['700 24px Oswald', '400 24px Chivo', '700 24px Chivo', '500 24px "Space Grotesk"', '700 24px "Space Grotesk"', '400 24px "Noto Sans TC"', '700 24px "Noto Sans TC"', '400 24px "Sedgwick Ave Display"']
    const optionalFaces = Object.entries(hudFonts).map(async ([path, url]) => {
      const family = path.endsWith('/rog-fonts.woff2') ? 'ROG Fonts' : 'Trade Gothic BdCn'
      const face = new FontFace(family, `url("${url}")`, { weight: '700' })
      await face.load()
      document.fonts.add(face)
    })
    // 長官原圖待機在開機時載好（上傳 GPU、畫頭像），選角預覽一出現就是清晰版、不在畫面上卡頓。
    const officerIdles = Promise.allSettled(officers.map(async (id) => { await loadHdSprite(this, id, true); paintHdHead(this, id) }))
    await Promise.race([
      Promise.allSettled([...optionalFaces, ...faces.map((face) => document.fonts.load(face, '選擇角色'))]),
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, 2000) }),
    ])
    clearTimeout(timeout)
    await officerIdles
    this.scene.start('AppScene')
  }
}
