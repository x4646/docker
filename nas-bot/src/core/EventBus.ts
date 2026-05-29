import { DomainEvent, IEventBus } from '../domain/shared/events/DomainEvent';
import { ILogger } from '../domain/shared/ILogger';

/**
 * 事件总线实现
 * 发布订阅模式，解耦Scheduler和Handler
 */
export class EventBus implements IEventBus {

  private readonly subscribers = new Map<string, Array<(event: DomainEvent) => void>>();

  constructor(private readonly logger: ILogger) {}

  publish(event: DomainEvent): void {
    const handlers = this.subscribers.get(event.eventName) || [];
    if (!handlers.length) {
      this.logger.debug('事件无订阅者', { eventName: event.eventName });
      return;
    }
    this.logger.debug('发布事件', { eventName: event.eventName, subscribers: handlers.length });
    handlers.forEach(handler => {
      Promise.resolve()
        .then(() => handler(event))
        .catch(e => this.logger.error('事件处理失败', { eventName: event.eventName, error: e.message }));
    });
  }

  subscribe(eventName: string, handler: (event: DomainEvent) => void): void {
    const existing = this.subscribers.get(eventName) || [];
    existing.push(handler);
    this.subscribers.set(eventName, existing);
    this.logger.debug('订阅事件', { eventName });
  }

  unsubscribe(eventName: string, handler: (event: DomainEvent) => void): void {
    const existing = this.subscribers.get(eventName) || [];
    this.subscribers.set(eventName, existing.filter(h => h !== handler));
  }
}
