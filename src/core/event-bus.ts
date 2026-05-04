import { appendFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { EventSchema, type Event, type EventType } from '../schemas/events.js';

type PublishPayload = Omit<Event, 'timestamp'> & { timestamp?: string };

export class EventBus {
  private emitter = new EventEmitter();

  constructor(private readonly eventsLogPath: string) {
    this.emitter.setMaxListeners(50);
  }

  publish(payload: PublishPayload): void {
    const full = EventSchema.parse({ timestamp: new Date().toISOString(), ...payload });
    try {
      appendFileSync(this.eventsLogPath, JSON.stringify(full) + '\n', 'utf8');
    } catch {}
    this.emitter.emit(full.type, full);
    this.emitter.emit('*', full);
  }

  on(type: EventType | '*', handler: (event: Event) => void): void {
    this.emitter.on(type as string, handler);
  }

  off(type: EventType | '*', handler: (event: Event) => void): void {
    this.emitter.off(type as string, handler);
  }
}
