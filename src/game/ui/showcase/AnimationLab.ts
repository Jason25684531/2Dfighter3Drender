import Phaser from 'phaser'
import { AngularPanel, HealthBar } from '../VisualComponents'
import { colorHex, uiTokens } from '../tokens/uiTokens'
import { aspectCover } from '../tokens/layout'
import { typography } from '../tokens/typography'
import { resolveStageAsset, stageTextureKey, type StageId } from '../assets/TestAssetManifest'
import { animationCategories, existingAnimationEntries, sampleCharacterAnimationManifest } from '../animation/FighterAnimationManifest'
import { FighterVideoRenderer } from '../animation/FighterVideoRenderer'
import { sampleWebmValidation } from '../assets/sampleWebmValidation'

export type AnimationLabOptions = { stageId: StageId; index: number; facing: 'LEFT' | 'RIGHT'; hud: boolean; loop: boolean }

/** DEV Animation Lab：預覽所有存在的 WebM；影片由子物件 FighterVideoRenderer 擁有，隨 Container 銷毀釋放。 */
export class AnimationLab extends Phaser.GameObjects.Container {
  static count(): number { return existingAnimationEntries().length }

  constructor(scene: Phaser.Scene, { stageId, index, facing, hud, loop }: AnimationLabOptions) {
    super(scene, 0, 0)
    const label = (text: string, x: number, y: number, size: number, color: string): Phaser.GameObjects.Text => scene.add.text(x, y, text, { ...typography.note, fontSize: size, color }).setOrigin(0.5)
    const cover = aspectCover(2752, 1536, 1920, 1080)
    this.add(scene.add.image(cover.x + cover.width / 2, cover.y + cover.height / 2, stageTextureKey(stageId)).setDisplaySize(cover.width, cover.height))
    this.add(scene.add.rectangle(960, 540, 1920, 1080, uiTokens.colors.background0, 0.56))
    this.add(scene.add.text(110, 112, 'CHARACTER ANIMATION LAB', typography.heading).setOrigin(0, 0.5))
    this.add(label('V preview  /  B stage  /  F facing  /  H HUD  /  L loop  /  R replay', 960, 165, uiTokens.type.body, colorHex('systemBlue')))
    const entries = existingAnimationEntries(); const entry = entries[index % entries.length]; const validation = sampleWebmValidation.find((item) => item.filename === entry.filename)
    const list = new AngularPanel(scene, 420, 760, uiTokens.colors.panelRaised).setPosition(270, 580); let y = -340
    animationCategories.forEach((category) => { list.add(scene.add.text(-180, y, category.label, { ...typography.note, fontSize: uiTokens.type.label, color: colorHex('systemBlue'), fontStyle: 'bold' }).setOrigin(0, 0.5)); y += 25; category.keys.forEach((key) => { const item = sampleCharacterAnimationManifest[key]; if (!item.url) return; list.add(scene.add.text(-165, y, (item.previewOnly ? 'PREVIEW ' : 'RUNTIME ') + item.key, { ...typography.note, fontSize: uiTokens.type.label, color: item.key === entry.key ? colorHex('playerGlow') : colorHex('textPrimary') }).setOrigin(0, 0.5)); y += 23 }); y += 8 })
    this.add(list)
    const diagnostics = new AngularPanel(scene, 500, 560, uiTokens.colors.panelRaised).setPosition(1590, 590)
    diagnostics.add(scene.add.text(-220, -225, 'DIAGNOSTICS', typography.secondaryAction).setOrigin(0, 0.5))
    diagnostics.add(scene.add.text(-220, -165, 'KEY ' + entry.key + '\nFILE ' + entry.filename + '\nDURATION ' + (validation?.durationMs ?? entry.nominalDurationMs ?? 'unknown') + 'ms\nDIMENSIONS ' + (validation ? validation.width + ' x ' + validation.height : 'runtime probe') + '\nLOOP ' + loop + '\nPREVIEW ONLY ' + entry.previewOnly + '\nFACING ' + facing + '\nSTAGE ' + resolveStageAsset(stageId).label + '\nPLAYBACK RATE natural', { ...typography.note, fontSize: uiTokens.type.label, lineSpacing: 7 }))
    const mediaStatus = scene.add.text(-220, 175, 'MEDIA PLACEHOLDER', { ...typography.note, fontSize: uiTokens.type.label, color: colorHex('systemBlue') })
    diagnostics.add(mediaStatus); this.add(diagnostics)
    const renderer = new FighterVideoRenderer(scene, sampleCharacterAnimationManifest, uiTokens.colors.playerPrimary, (status) => mediaStatus.setText('MEDIA ' + status))
    renderer.setPosition(960, 850); renderer.preview(entry.key, facing, loop); this.add(renderer)
    if (hud) {
      const bar = scene.add.container(0, 0); bar.add(scene.add.rectangle(960, 105, 1740, 142, uiTokens.colors.background0, 0.82).setStrokeStyle(2, uiTokens.colors.lineBright))
      const playerBar = new HealthBar(scene, 610, uiTokens.colors.playerPrimary).setPosition(180, 130); const enemyBar = new HealthBar(scene, 610, uiTokens.colors.enemyPrimary, true).setPosition(1130, 130)
      bar.add([playerBar, enemyBar]); bar.add(scene.add.text(960, 155, '60', typography.timer).setOrigin(0.5)); bar.add(label('ROG_Player', 230, 90, uiTokens.type.title, colorHex('textPrimary'))); bar.add(label('ROG_SAGA', 1690, 90, uiTokens.type.title, colorHex('textPrimary'))); this.add(bar)
    }
  }
}
