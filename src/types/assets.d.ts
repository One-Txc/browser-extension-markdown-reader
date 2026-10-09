/**
 * CSS 以字符串形式导入（由 esbuild 的 `loader: { '.css': 'text' }` 提供）。
 * 这里补上类型声明，让 tsc 通过。
 */
declare module '*.css' {
  const content: string;
  export default content;
}
