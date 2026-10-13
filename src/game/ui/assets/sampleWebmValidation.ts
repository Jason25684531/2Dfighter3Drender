export type SampleWebmValidation = { filename: string; width: number; height: number; durationMs: number; codec: 'vp9'; alphaMode: 1 }

const rawValidation: readonly [string, number, number, number][] = [
  ['blockstun.webm', 122, 266, 167], ['crA.webm', 188, 166, 234], ['crB.webm', 236, 156, 267], ['crC.webm', 194, 288, 567], ['crD.webm', 236, 158, 550], ['crouch.webm', 126, 168, 750], ['hitstun.webm', 214, 266, 417], ['idle.webm', 130, 268, 2334], ['jA.webm', 162, 276, 234], ['jB.webm', 268, 272, 267], ['jC.webm', 214, 284, 267], ['jD.webm', 268, 288, 217], ['jump.webm', 162, 324, 750], ['stA.webm', 188, 266, 250], ['stB.webm', 160, 264, 317], ['stC.webm', 222, 260, 567], ['stD.webm', 190, 266, 484], ['walkB.webm', 144, 272, 2250], ['walkF.webm', 158, 276, 1250],
]

export const sampleWebmValidation: readonly SampleWebmValidation[] = rawValidation.map(([filename, width, height, durationMs]) => ({ filename, width, height, durationMs, codec: 'vp9' as const, alphaMode: 1 as const }))
