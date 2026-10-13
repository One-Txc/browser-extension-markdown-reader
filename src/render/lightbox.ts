/**
 * 图片点击放大。
 *
 * 设计取舍：**链接内的图片不劫持点击**。
 * 形如 `[![图](./a.png)](https://example.com)` 的写法，作者意图是点击跳转，
 * 若被我们拦下来放大，Markdown 里就没法做"图片链接"了。其余图片一律可点开放大。
 *
 * 交互：点击打开 → 点击图片在 1x/2x 间切换 → 滚轮连续缩放 →
 *       放大后按住拖动平移 → 左右按钮或方向键切换图片 →
 *       Esc 或点击空白关闭。
 *
 * 图片集合在打开时按**文档中出现顺序**快照一次，同一份列表在预览期间复用 ——
 * 这样连按方向键不会每次重新扫描 DOM，索引也稳定。
 */

import { t } from '../shared/i18n';

const OVERLAY_CLASS = 'md-reader-lightbox';
const BODY_LOCK_CLASS = 'md-reader-lightbox-open';
const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.15;

/** 同一时刻只允许一个预览层 */
let active: HTMLElement | null = null;

export function setupImageZoom(root: HTMLElement): void {
  // 链接内的图片保持原行为（跳转），不劫持
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img')).filter(
    (img) => !img.closest('a')
  );

  images.forEach((img, index) => {
    img.classList.add('md-reader-zoomable');
    img.addEventListener('click', (event) => {
      event.preventDefault();
      openLightbox(images, index);
    });
  });
}

function openLightbox(images: HTMLImageElement[], startIndex: number): void {
  if (active) return;

  // 加载失败（破图）就不打开预览，否则用户会看到一张全屏的空白图
  const first = images[startIndex];
  if (!first) return;
  if (first.complete && first.naturalWidth === 0) return;
  if (!(first.currentSrc || first.src)) return;

  let index = startIndex;
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
  box.setAttribute('aria-label', t('imagePreview'));

  const img = document.createElement('img');
  img.draggable = false;

  const hint = document.createElement('div');
  hint.className = 'md-reader-lightbox-hint';
  // 只有一张图时不必提示切换
  hint.textContent =
    images.length > 1 ? t('imagePreviewHintNav') : t('imagePreviewHint');

  box.append(img, hint);

  const apply = (): void => {
    img.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    img.classList.toggle('is-zoomed', scale > 1);
  };

  /** 切到第 i 张；越界则回到另一端（循环） */
  function show(i: number): void {
    index = (i + images.length) % images.length;
    const source = images[index];
    img.src = source.currentSrc || source.src;
    img.alt = source.alt || '';
    /*
     * ★ 必须重置视图。新图会沿用上一张的 transform，
     * 于是「把第一张放大到 4 倍后翻页」会让第二张一上来就跑偏。
     */
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    apply();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (images.length < 2) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      show(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      show(index + 1);
    }
  }

  function close(): void {
    if (active !== box) return;
    box.remove();
    document.body.classList.remove(BODY_LOCK_CLASS);
    document.removeEventListener('keydown', onKey, true);
    active = null;
  }

  // 多于一张时才加左右切换按钮
  if (images.length > 1) {
    const mkNav = (dir: -1 | 1, label: string, className: string): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `md-reader-lightbox-nav ${className}`;
      button.textContent = dir < 0 ? '‹' : '›';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', (event) => {
        // 阻止冒泡，否则会被下面「点空白关闭」的逻辑当成点到了空白
        event.stopPropagation();
        show(index + dir);
      });
      return button;
    };

    box.append(
      mkNav(-1, t('imagePrev'), 'is-prev'),
      mkNav(1, t('imageNext'), 'is-next')
    );
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

  // 首图在这里统一设置，避免上面那段「破图检查」与 show() 各写一遍
  show(startIndex);
}
