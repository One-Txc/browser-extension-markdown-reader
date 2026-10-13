/**
 * 性能标记 —— 测量用户侧的**真实耗时**，而不是靠估算。
 *
 * 为什么需要它：
 * 我们的设计是 content script 在 document_start 立刻隐藏页面、渲染完再恢复可见，
 * 这段是用户直接感知的白屏。评估任何构建改造（例如引入 WXT）时，
 * 必须拿这段的真实数字对比，而不是"大概增加几毫秒"。
 *
 * 开销：
 * performance.mark 是原生 API，微秒级；stages 数组只有个位数元素。
 * 常驻生产不会造成可测量的影响。
 *
 * 取数方式：
 * 打开任意 .md 文档，控制台会输出一行 `[Markdown Read 性能] {...}`，
 * 也可以直接查看全局变量：
 *   __mdReaderPerf
 * 或者在 DevTools 的 Performance 面板里按 `md-reader:` 前缀找原生标记。
 */

const PREFIX = 'md-reader';

interface Stage {
  name: string;
  at: number;
}

const stages: Stage[] = [];

/**
 * content script 开始执行的时刻，相对导航开始计。
 * 这个值包含扩展注入本身的延迟。
 */
const injectMs = Math.round(performance.now());

/** 打一个阶段标记 */
export function markPerf(name: string): void {
  const at = performance.now();
  stages.push({ name, at });

  // 同时打原生标记，便于在 Performance 面板里与其它事件对齐
  try {
    performance.mark(`${PREFIX}:${name}`);
  } catch {
    /* 个别环境不支持，忽略 */
  }
}

export interface PerfReport {
  /** content script 开始执行的时刻（相对导航开始，ms） */
  injectMs: number;
  /**
   * 内容恢复可见的时刻（相对导航开始，ms）。
   * **这是用户感知的白屏结束点，也是最关键的对比指标。**
   */
  visibleMs: number;
  /** 各阶段相对上一阶段的耗时 */
  stages: Array<{ stage: string; ms: number; atMs: number }>;
}

export function reportPerf(): PerfReport {
  return {
    injectMs,
    visibleMs: Math.round(performance.now()),
    stages: stages.map((stage, index) => ({
      stage: stage.name,
      ms: Math.round(stage.at - (index === 0 ? injectMs : stages[index - 1].at)),
      atMs: Math.round(stage.at),
    })),
  };
}

/** 发布结果：挂到 window 上，并输出一行 JSON 便于直接复制 */
export function publishPerf(): void {
  const report = reportPerf();
  (window as unknown as Record<string, unknown>).__mdReaderPerf = report;
  console.info('[Markdown Read 性能]', JSON.stringify(report));
}
