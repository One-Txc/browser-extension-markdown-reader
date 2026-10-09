/**
 * 图片点击放大。
 *
 * 设计取舍：**链接内的图片不劫持点击**。
 * 形如 `[![图](./a.png)](https://example.com)` 的写法，作者意图是点击跳转，
 * 若被我们拦下来放大，Markdown 里就没法做"图片链接"了。其余图片一律可点开放大。
 *
 * 交互：点击打开 → 点击图片在 1x/2x 间切换 → 滚轮连续缩放 →
 *       放大后按住拖动平移 → Esc 或点击空白关闭。
 */

const OVERLAY_CLASS = 'md-reader-lightbox';
const BODY_LOCK_CLASS = 'md-reader-lightbox-open';
const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.15;

/** 同一时刻只允许一个预览层 */
let active: HTMLElement | null = null;

export function setupImageZoom(root: HTMLElement): void {
  root.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    // 链接内的图片保持原行为（跳转），不劫持
    if (img.closest('a')) return;

    img.classList.add('md-reader-zoomable');
    img.addEventListener('click', (event) => {
      event.preventDefault();
      openLightbox(img);
    });
  });
}

function openLightbox(source: HTMLImageElement): void {
  if (active) return;

  // 加载失败（破图）就不打开预览，否则用户会看到一张全屏的空白图
  if (source.complete && source.naturalWidth === 0) return;

  const src = source.currentSrc || source.src;
  if (!src) return;

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let dragged = false;
  let startX = 0;
  let startY = 0;

  const box = document.createElement('div');
  box.className = OVERLAY_CLASS;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', '图片预览');

  const img = document.createElement('img');
  img.src = src;
  img.alt = source.alt || '';
  img.draggable = false;

  const hint = document.createElement('div');
  hint.className = 'md-reader-lightbox-hint';
  hint.textContent = '滚轮缩放 · 拖动平移 · Esc 关闭';

  box.append(img, hint);

  const apply = (): void => {
    img.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    img.classList.toggle('is-zoomed', scale > 1);
  };

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  function close(): void {
    if (active !== box) return;
    box.remove();
    document.body.classList.remove(BODY_LOCK_CLASS);
    document.removeEventListener('keydown', onKey, true);
    active = null;
  }

  // 点击图片以外的区域关闭
  box.addEventListener('click', (event) => {
    if (event.target === box) close();
  });

  // 点击图片：在 1x / 2x 之间切换；刚拖动过则忽略
  img.addEventListener('click', (event) => {
    event.stopPropagation();
    if (dragged) {
      dragged = false;
      return;
    }
    if (scale > 1) {
      scale = 1;
      offsetX = 0;
      offsetY = 0;
    } else {
      scale = 2;
    }
    apply();
  });

  img.addEventListener('pointerdown', (event) => {
    if (scale <= 1) return;
    dragging = true;
    dragged = false;
    startX = event.clientX - offsetX;
    startY = event.clientY - offsetY;
    img.classList.add('is-dragging');
    img.setPointerCapture(event.pointerId);
  });

  img.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    dragged = true;
    offsetX = event.clientX - startX;
    offsetY = event.clientY - startY;
    apply();
  });

  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    img.classList.remove('is-dragging');
    try {
      img.releasePointerCapture(event.pointerId);
    } catch {
      /* 指针已经释放，忽略 */
    }
  };
  img.addEventListener('pointerup', endDrag);
  img.addEventListener('pointercancel', endDrag);

  box.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
      if (scale <= 1) {
        offsetX = 0;
        offsetY = 0;
      }
      apply();
    },
    { passive: false }
  );

  document.body.appendChild(box);
  document.body.classList.add(BODY_LOCK_CLASS);
  document.addEventListener('keydown', onKey, true);
  active = box;
}
