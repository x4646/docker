/**
 * AI策略接口
 * 定义AI调用的统一契约
 * 所有AI实现必须遵守此接口（策略模式）
 * 好处：切换AI只需替换实现，调用方零改动
 */
export interface IAIStrategy {
  /**
   * 发送提示词，获取AI回复
   * @param prompt 提示词
   * @returns AI生成的文本
   */
  ask(prompt: string): Promise<string>;

  /**
   * 检查AI服务是否可用
   */
  isAvailable(): Promise<boolean>;
}
