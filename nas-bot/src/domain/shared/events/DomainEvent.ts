/**
 * 领域事件基类
 * 所有事件继承此类
 */
export abstract class DomainEvent {
  public readonly occurredAt: Date;
  public readonly eventName:  string;

  constructor(eventName: string) {
    this.eventName  = eventName;
    this.occurredAt = new Date();
  }
}

/**
 * 事件总线接口
 * 解耦发布者和订阅者
 */
export interface IEventBus {
  publish(event: DomainEvent): void;
  subscribe(eventName: string, handler: (event: DomainEvent) => void): void;
}
