/**
 * markdown-it-task-lists 没有自带类型声明，这里手工补上。
 */
declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';

  interface TaskListsOptions {
    /** 是否启用（默认 true） */
    enabled?: boolean;
    /** 是否渲染 <label> 包裹（默认 false） */
    label?: boolean;
    /** label 是否放在 input 之后（默认 false） */
    labelAfter?: boolean;
  }

  const plugin: (md: MarkdownIt, options?: TaskListsOptions) => void;
  export default plugin;
}
