export type AspectCover = { width: number; height: number; x: number; y: number; scale: number }

export const aspectCover = (sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): AspectCover => {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  return { width, height, x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, scale }
}
