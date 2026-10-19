/**
 * 「去开启文件访问权限」的引导内容 —— popup 与安装后的引导页共用。
 *
 * ★ 为什么不写进 HTML：同一段内容要在两个页面出现（popup 340px、引导页整页），
 *   而文案全部走 t()、还要带复制与重新检测的交互，用 DOM 生成比维护两份 HTML 可靠。
 *   样式单独放在 permission-guide.css，由这里注入一次。
 *
 * ★ 只讲「做什么」，不讲「为什么」：用户不需要理解浏览器为什么要这个开关，
 *   需要的是三步把他带过去。所以标题只说明本扩展需要哪个权限，正文就是操作步骤。
 *
 * ★ 引导页不做「跳过」：没开权限时 content script 根本不会注入，设置项对本地文档
 *   完全无效 —— 与其让用户填一堆用不上的设置，不如先把权限解决。
 *   （在线 md 场景也走同一条路，这是已知取舍，见 README。）
 */

import { EXT_NAME } from '../shared/brand';
import { t } from '../shared/i18n';
import { extensionSettingsUrl } from '../shared/permission';
import css from './permission-guide.css';

const STYLE_ID = 'md-reader-guide-styles';

export interface GuideOptions {
  /**
   * 点「重新检测」时调用。
   * 返回 true 表示权限已经开好（调用方负责把界面切到「已授权」或刷新页面）；
   * 返回 false 表示还没开 —— 这里会显示一句「仍未开启」，避免点了没反应。
   */
  onRecheck: () => Promise<boolean>;

  /**
   * 可选：提供时多出一个「在标签页中打开完整说明」的次要按钮。
   * popup 只有 340px 宽，而且焦点一离开就关掉了；同一份说明放到标签页里
   * 既能看全，也能一直开着等用户去开权限 —— 所以引导页本身不需要这个按钮。
   */
  onOpenInTab?: () => void;

  /**
   * 可选：示意图地址（相对当前页面的路径）。
   * 只有引导页传 —— 授权开关的截图在 340px 的 popup 里会缩到看不清。
   */
  screenshot?: string;

  /**
   * 可选：尝试直接打开扩展详情页（chrome://extensions/?id=…）。
   * 返回 true 表示标签页已经打开；false 表示浏览器拦住了，调用方应已把地址复制到剪贴板。
   *
   * ★ chrome:// 协议是否允许由 chrome.tabs.create 打开，各版本行为不一致 —— 所以
   *   这里只「尝试」，失败就回退到「地址已复制，自己粘贴」。能打开就省掉两步操作。
   */
  onOpenSettings?: () => Promise<boolean>;
}

/** 样式只注入一次（popup 里可能因重新渲染被调用多次） */
function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.append(style);
}

/**
 * 打开放大层。
 *
 * 为什么不直接用「点开原图在新标签页」：扩展页里跳转会把用户带离说明，
 * 回来还得再找一遍步骤。这里用一层覆盖层，点任意处或按 Esc 就关掉，
 * 关掉后焦点回到原来那张图上，键盘用户不会丢失位置。
 */
function openLightbox(src: string, alt: string, trigger: HTMLElement): void {
  const overlay = document.createElement('div');
  overlay.className = 'md-guide-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.tabIndex = -1;

  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'md-guide-lightbox-close';
  close.setAttribute('aria-label', t('permissionPreviewClose'));
  close.textContent = '×';

  const dismiss = (): void => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    trigger.focus();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') dismiss();
  };

  overlay.addEventListener('click', (event) => {
    // 点图片本身不关（有时用户是在看细节），点周围的空白才关
    if (event.target === overlay) dismiss();
  });
  close.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey);

  overlay.append(img, close);
  document.body.append(overlay);
  overlay.focus();
}

/** 生成「可点击放大」的示意图 */
function createScreenshot(src: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'md-guide-shot';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'md-guide-shot-open';
  trigger.setAttribute('aria-label', t('permissionPreviewOpen'));
  trigger.title = t('permissionPreviewOpen');

  const img = document.createElement('img');
  img.src = src;
  img.alt = t('permissionScreenshotAlt');
  img.loading = 'lazy';

  trigger.append(img);
  trigger.addEventListener('click', () => openLightbox(src, img.alt, trigger));

  wrap.append(trigger);
  return wrap;
}

/** 渲染「去开启文件访问权限」的引导 */
export function renderPermissionGuide(root: HTMLElement, options: GuideOptions): void {
  ensureStyles();
  root.replaceChildren();

  const wrap = document.createElement('div');
  wrap.className = 'md-guide';

  // 标题只说要什么权限：产品名由各自页面的标题单独显示，标题太长会挤成三行
  const title = document.createElement('h2');
  title.className = 'md-guide-title';
  title.textContent = t('permissionTitle');

  const steps = document.createElement('ol');
  steps.className = 'md-guide-steps';

  /* 第 1 步：地址本身就是入口，点它直接打开扩展详情页；复制是备用手段 */
  const step1 = document.createElement('li');
  step1.append(t('popupStep1'));

  const url = extensionSettingsUrl();
  const urlRow = document.createElement('div');
  urlRow.className = 'md-guide-url';

  const openFailed = document.createElement('span');
  openFailed.className = 'md-guide-note';
  openFailed.hidden = true;

  /*
   * 地址做成 <a>：链接的下划线是最直接的「可以点」信号。
   *
   * ★ 但点击仍然走 chrome.tabs.create（preventDefault 后再跳），不用 href 原生导航 ——
   *   chrome:// 地址由页面自己导航各版本行为不一致，而 tabs.create 这条路已经实测可用。
   *   href 保留只是为了语义与「地址可复制/可看状态栏」，实际跳转由 JS 负责。
   */
  const openSettings = document.createElement('a');
  openSettings.className = 'md-guide-url-open';
  openSettings.href = url;
  openSettings.setAttribute('aria-label', t('permissionOpenSettings'));
  openSettings.title = t('permissionOpenSettings');

  const code = document.createElement('code');
  code.textContent = url;

  // 末尾的 ↗ 再补一个「会跳走」的暗示
  const jumpIcon = document.createElement('span');
  jumpIcon.className = 'md-guide-url-open-icon';
  jumpIcon.setAttribute('aria-hidden', 'true');
  jumpIcon.textContent = '↗';

  openSettings.append(code, jumpIcon);

  if (!options.onOpenSettings) {
    // 没有提供打开能力时不要假装能点
    openSettings.removeAttribute('href');
    openSettings.setAttribute('aria-disabled', 'true');
    openSettings.className = 'md-guide-url-open is-disabled';
  } else {
    openSettings.addEventListener('click', (event) => {
      event.preventDefault();
      void (async () => {
        if (openSettings.classList.contains('is-busy')) return;
        openSettings.classList.add('is-busy');
        openFailed.hidden = true;

        let opened = false;
        try {
          opened = (await options.onOpenSettings?.()) ?? false;
        } finally {
          openSettings.classList.remove('is-busy');
        }

        if (opened) return;

        // 打不开时地址已由 openExtensionSettings 复制好，这里只负责说明
        openFailed.textContent = t('permissionOpenFailed');
        openFailed.hidden = false;
        window.setTimeout(() => {
          openFailed.hidden = true;
        }, 5000);
      })();
    });
  }

  const copy = document.createElement('button');
  copy.type = 'button';
  // 小一号：它只是旁边的备用操作，不该和正文里的地址抢视觉重量
  copy.className = 'md-guide-btn md-guide-btn-sm';
  copy.textContent = t('permissionCopy');

  const copied = document.createElement('span');
  copied.className = 'md-guide-copied';
  copied.textContent = t('permissionCopied');
  copied.hidden = true;

  copy.addEventListener('click', () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(url);
        copied.hidden = false;
        window.setTimeout(() => {
          copied.hidden = true;
        }, 1500);
      } catch {
        /* 剪贴板不可用时地址已经显示在页面上，可以手动选中复制 */
      }
    })();
  });

  urlRow.append(openSettings, copy, copied, openFailed);
  step1.append(urlRow);

  /* 第 2 步：打开哪个开关 —— 整句强调一下，这是用户真正要做的动作 */
  const step2 = document.createElement('li');
  // 第 1 步给的就是本扩展详情页的地址，所以这一步直接说开关名即可，不必再提产品名
  const step2Key = document.createElement('strong');
  step2Key.className = 'md-guide-key';
  step2Key.textContent = t('popupStep2');
  step2.append(step2Key);

  // 示意图紧跟在第 2 步下面：它画的就是这一步要打开的那个开关
  if (options.screenshot) step2.append(createScreenshot(options.screenshot));

  /* 第 3 步：这一步不能省 —— 权限开了但页面没刷新，用户会以为没生效 */
  const step3 = document.createElement('li');
  step3.textContent = t('popupStep3');

  steps.append(step1, step2, step3);

  /* 底部操作区：说明链接在上，按钮在下 */
  const actions = document.createElement('div');
  actions.className = 'md-guide-actions';

  const buttons = document.createElement('div');
  buttons.className = 'md-guide-buttons';

  if (options.onOpenInTab) {
    // 文字链放在「重新检测」上方：它只是补充信息，不该和主按钮抢位置
    const openInTab = document.createElement('button');
    openInTab.type = 'button';
    openInTab.className = 'md-guide-link';
    openInTab.textContent = t('permissionOpenInTab');
    openInTab.addEventListener('click', () => options.onOpenInTab?.());
    actions.append(openInTab);
  }

  const recheck = document.createElement('button');
  recheck.type = 'button';
  recheck.className = 'md-guide-btn md-guide-btn-primary';
  recheck.textContent = t('permissionRecheck');

  // 点完必须给反馈：之前点了没反应，用户会以为卡死
  const note = document.createElement('span');
  note.className = 'md-guide-note';
  note.hidden = true;

  recheck.addEventListener('click', () => {
    void (async () => {
      if (recheck.disabled) return;

      const label = recheck.textContent ?? t('permissionRecheck');
      recheck.disabled = true;
      recheck.textContent = t('permissionChecking');
      note.hidden = true;

      let allowedNow = false;
      try {
        allowedNow = await options.onRecheck();
      } finally {
        // 成功时调用方通常已经把界面换掉了，这里的还原只服务于失败路径
        recheck.disabled = false;
        recheck.textContent = label;
      }

      if (allowedNow) return;

      note.textContent = t('permissionStillOff');
      note.hidden = false;
      window.setTimeout(() => {
        note.hidden = true;
      }, 3000);
    })();
  });

  buttons.append(recheck, note);
  actions.append(buttons);

  wrap.append(title, steps, actions);
  root.append(wrap);
}

/** 渲染「已授权」状态：引导页在检测到权限已经打开时用 */
export function renderPermissionGranted(root: HTMLElement): void {
  ensureStyles();
  root.replaceChildren();

  const wrap = document.createElement('div');
  wrap.className = 'md-guide md-guide--granted';

  const title = document.createElement('h2');
  title.textContent = t('permissionGranted');

  const hint = document.createElement('p');
  hint.textContent = t('permissionGrantedHint', [EXT_NAME]);

  wrap.append(title, hint);
  root.append(wrap);
}
