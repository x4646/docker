/**
 * 消息上下文
 * 在中间件链和Handler之间传递数据
 */
export interface MessageContext {
  chatId:    string;
  text:      string;       // 原始消息文本
  command:   string;       // 解析后的指令
  args:      string;       // 指令参数
  userId:    string;
  username?: string;
  /** 中间件可在此附加额外数据 */
  meta:      Record<string, unknown>;
}

/**
 * 中间件接口
 * 责任链模式：每个中间件处理后决定是否继续传递
 */
export interface IMiddleware {
  /**
   * 处理消息
   * @param ctx  消息上下文
   * @param next 调用下一个中间件
   */
  handle(ctx: MessageContext, next: () => Promise<void>): Promise<void>;
}
