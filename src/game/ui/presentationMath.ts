export const healthRatio = (value: number): number => Math.max(0, Math.min(1, value))

export const healthCrop = (ratio: number, width: number, rightSide: boolean) => {
  const visible = Math.round(width * healthRatio(ratio))
  return { x: rightSide ? 0 : width - visible, width: visible }
}
export const healthPercent = (ratio: number): string => `${Math.round(healthRatio(ratio) * 100)}%`
export const remainingLives = (opponentWins: number): number => Math.max(0, 2 - opponentWins)
export const panelPoints = (width: number, height: number, slant: number, shape: 'slant' | 'chamfer' = 'slant'): number[] => {
  const cut = Math.max(0, Math.min(slant, width / 2, height / 2)), x = width / 2, y = height / 2
  return shape === 'slant' ? [-x + cut, -y, x, -y, x - cut, y, -x, y] : [-x + cut, -y, x, -y, x, y - cut, x - cut, y, -x, y, -x, -y + cut]
}
