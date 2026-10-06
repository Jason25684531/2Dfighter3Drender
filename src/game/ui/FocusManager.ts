import type { UIEventBus } from './UIEventBus'
type Item = { id: string; enabled: boolean }
export class FocusManager {
  private groups = new Map<string, Item[]>(); private active = ''; private focused?: string
  constructor(private readonly events: UIEventBus) {}
  register(group: string, id: string, enabled = true): void { const items = this.groups.get(group) ?? []; if (!items.some((item) => item.id === id)) items.push({ id, enabled }); this.groups.set(group, items) }
  unregister(group: string, id: string): void { this.groups.set(group, (this.groups.get(group) ?? []).filter((item) => item.id !== id)); if (this.active === group && this.focused === id) this.move(1) }
  activate(group: string): void { this.active = group; this.focused = undefined; this.move(1) }
  current(): string | undefined { return this.focused }
  reset(): void { const previous = this.focused; this.active = ''; this.focused = undefined; if (previous) this.events.emit('FOCUS_CHANGED', { group: '', previous, next: undefined }) }
  move(delta: number): void { const items = (this.groups.get(this.active) ?? []).filter((item) => item.enabled); const previous = this.focused; if (!items.length) this.focused = undefined; else { const index = items.findIndex((item) => item.id === previous); this.focused = items[index < 0 ? (delta < 0 ? items.length - 1 : 0) : (index + delta + items.length) % items.length].id }; if (previous !== this.focused) this.events.emit('FOCUS_CHANGED', { group: this.active, previous, next: this.focused }) }
}
