/**
 * 页面内的轻提示条。
 *
 * 用于「操作没做成」但不需要用户确认的场景：打开设置面板失败、收藏已满。
 * 样式固定在 app.css 的 `.md-reader-toast`；同一时刻只保留最新一条，
 * 4.2 秒后自动消失。
 */

const TOAST_CLASS = 'md-reader-toast';
const TOAST_MS = 4200;

/**
 * 显示一条提示。
 *
 * @param message 已本地化的文案
 * @param anchor  触发按钮；提示会贴在它下方，随其位置走（窄屏时按钮位置会变）
 */
export function showToast(message: string, anchor?: HTMLElement | null, ms = TOAST_MS): void {
  // 连点多次时只保留最新一个
  document.querySelector(`.${TOAST_CLASS}`)?.remove();

  const toast = document.createElement('div');
  toast.className = TOAST_CLASS;
  toast.setAttribute('role', 'status');
  toast.textContent = message;

  if (anchor) {
    const box = anchor.getBoundingClientRect();
    const right = Math.max(12, window.innerWidth - box.right);
    toast.style.top = `${box.bottom + 8}px`;
    toast.style.right = `${right}px`;
    // 星标离右边缘 96px，窄屏上若还用 CSS 的 290px 上限会顶出屏幕左侧，
    // 所以按实际可用宽度再收一次
    toast.style.maxWidth = `${Math.max(160, window.innerWidth - right - 12)}px`;
  } else {
    toast.style.top = '56px';
    toast.style.right = '12px';
    toast.style.maxWidth = `${Math.max(160, window.innerWidth - 24)}px`;
  }

  document.body.append(toast);
  window.setTimeout(() => toast.remove(), ms);
}
