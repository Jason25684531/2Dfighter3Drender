export const healthRatio = (value: number): number => Math.max(0, Math.min(1, value))
export const panelPoints = (width: number, height: number, slant: number, shape: 'slant' | 'chamfer' = 'slant'): number[] => {
  const cut = Math.max(0, Math.min(slant, width / 2, height / 2)), x = width / 2, y = height / 2
  return shape === 'slant' ? [-x + cut, -y, x, -y, x - cut, y, -x, y] : [-x + cut, -y, x, -y, x, y - cut, x - cut, y, -x, y, -x, -y + cut]
}
