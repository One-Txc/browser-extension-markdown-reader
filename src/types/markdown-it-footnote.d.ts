/**
 * markdown-it-footnote 没有自带类型声明，这里手工补上。
 */
declare module 'markdown-it-footnote' {
  import type MarkdownIt from 'markdown-it';
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}
