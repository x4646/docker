/**
 * 通用右键菜单组件
 */
class ContextMenu {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'context-menu';
    document.body.appendChild(this.el);

    // 点击其他地方关闭
    document.addEventListener('click', () => this.hide());
    document.addEventListener('contextmenu', () => this.hide());
  }

  show(x, y, items) {
    this.el.innerHTML = items.map(item => {
      if (item.sep)   return '<div class="ctx-sep"></div>';
      if (item.label) return `<div class="ctx-label">${item.label}</div>`;
      return `<div class="ctx-item ${item.danger?'danger':''}" data-action="${item.id||''}">
        <span>${item.icon||''}</span>
        <span>${item.text}</span>
      </div>`;
    }).join('');

    // 绑定事件
    this.el.querySelectorAll('.ctx-item[data-action]').forEach((el, i) => {
      const item = items.filter(it => !it.sep && !it.label)[i];
      if (item && item.action) {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.hide();
          item.action();
        });
      }
    });

    // 定位（防止超出屏幕）
    this.el.classList.add('show');
    const rect = this.el.getBoundingClientRect();
    const vw   = window.innerWidth;
    const vh   = window.innerHeight;
    this.el.style.left = (x + rect.width  > vw ? x - rect.width  : x) + 'px';
    this.el.style.top  = (y + rect.height > vh ? y - rect.height : y) + 'px';
  }

  hide() {
    this.el.classList.remove('show');
  }
}

// 全局单例
const ctxMenu = new ContextMenu();
