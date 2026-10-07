import type { InputSnapshot } from '../input/InputManager'
import { intentFromInput, type FighterIntent } from './CombatWorld'

export class PlayerController {
  getIntent(input: InputSnapshot): FighterIntent { return intentFromInput(input) }
}
