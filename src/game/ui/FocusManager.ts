import type { UIEventBus } from './UIEventBus'
type Item = { id: string; enabled: boolean; activate?: () => void }
export class FocusManager {
  private groups = new Map<string, Item[]>(); private active = ''; private focused?: string
  constructor(private readonly events: UIEventBus) {}
  register(group: string, id: string, enabled = true, activate?: () => void): () => void { const items = this.groups.get(group) ?? []; const existing = items.find((item) => item.id === id); if (existing) { existing.enabled = enabled; existing.activate = activate; } else items.push({ id, enabled, activate }); this.groups.set(group, items); return () => this.unregister(group, id) }
  unregister(group: string, id: string): void { this.groups.set(group, (this.groups.get(group) ?? []).filter((item) => item.id !== id)); if (this.active === group && this.focused === id) this.move(1) }
  clearGroup(group: string): void { const hadFocus = this.active === group && this.focused !== undefined; this.groups.delete(group); if (this.active === group) this.focused = undefined; if (hadFocus) this.events.emit('FOCUS_CHANGED', { group, next: undefined }) }
  setEnabled(group: string, id: string, enabled: boolean): void { const item = this.groups.get(group)?.find((entry) => entry.id === id); if (item) { item.enabled = enabled; if (!enabled && this.active === group && this.focused === id) this.move(1) } }
  activateFocused(): boolean { const item = this.groups.get(this.active)?.find((entry) => entry.id === this.focused && entry.enabled); if (!item?.activate) return false; item.activate(); return true }
  activate(group: string): void { this.active = group; this.focused = undefined; this.move(1) }
  current(): string | undefined { return this.focused }
  reset(): void { const previous = this.focused; this.active = ''; this.focused = undefined; if (previous) this.events.emit('FOCUS_CHANGED', { group: '', previous, next: undefined }) }
  move(delta: number): void { const items = (this.groups.get(this.active) ?? []).filter((item) => item.enabled); const previous = this.focused; if (!items.length) this.focused = undefined; else { const index = items.findIndex((item) => item.id === previous); this.focused = items[index < 0 ? (delta < 0 ? items.length - 1 : 0) : (index + delta + items.length) % items.length].id }; if (previous !== this.focused) this.events.emit('FOCUS_CHANGED', { group: this.active, previous, next: this.focused }) }
}
