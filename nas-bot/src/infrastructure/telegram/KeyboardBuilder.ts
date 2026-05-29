/**
 * 键盘按钮定义
 */
export interface KeyboardButton {
  text: string;
}

/**
 * 键盘构建器
 * 使用建造者模式构建Telegram键盘
 * 好处：链式调用，语义清晰，易于扩展
 *
 * 使用示例：
 * const kb = new KeyboardBuilder()
 *   .row(['📈 股票状态', '▶️ 股票开启'])
 *   .row(['💾 系统状态', '🐳 容器列表'])
 *   .persistent()
 *   .build();
 */
export class KeyboardBuilder {

  private rows:        string[][] = [];
  private _resize:     boolean    = true;
  private _persistent: boolean    = false;

  /**
   * 添加一行按钮
   * @param buttons 按钮文字数组
   */
  row(buttons: string[]): this {
    this.rows.push(buttons);
    return this;
  }

  /**
   * 自适应大小
   */
  resize(value: boolean = true): this {
    this._resize = value;
    return this;
  }

  /**
   * 持久显示键盘
   */
  persistent(value: boolean = true): this {
    this._persistent = value;
    return this;
  }

  /**
   * 构建键盘对象
   */
  build(): Record<string, unknown> {
    return {
      keyboard:          this.rows.map(row => row.map(text => ({ text }))),
      resize_keyboard:   this._resize,
      persistent:        this._persistent,
    };
  }
}
