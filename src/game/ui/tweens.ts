export const stopOwnedTweens = <T extends { stop: () => unknown }>(tweens: T[]): void => {
  tweens.splice(0).forEach((tween) => tween.stop())
}
