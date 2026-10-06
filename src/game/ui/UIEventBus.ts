export type UIEvents = {
  SUBSTATE_CHANGED: { screen: string; previous: string; next: string }
  FOCUS_CHANGED: { group: string; previous?: string; next?: string }
  OVERLAY_CHANGED: { open: boolean }
}

export class UIEventBus {
  private readonly listeners = new Map<keyof UIEvents, Set<(payload: unknown) => void>>()

  on<K extends keyof UIEvents>(event: K, listener: (payload: UIEvents[K]) => void): () => void {
    const listeners = this.listeners.get(event) ?? new Set<(payload: unknown) => void>()
    listeners.add(listener as (payload: unknown) => void)
    this.listeners.set(event, listeners)
    return () => listeners.delete(listener as (payload: unknown) => void)
  }

  emit<K extends keyof UIEvents>(event: K, payload: UIEvents[K]): void {
    this.listeners.get(event)?.forEach((listener) => listener(payload))
  }
}
