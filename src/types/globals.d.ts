/**
 * 构建时注入的全局常量（见 scripts/build.mjs 的 define 配置）。
 *
 * 注意：值在构建脚本启动时求值 —— watch 模式下要重启才更新。
 */

/** 本次构建的时间，形如 2026/08/19 15:24 */
declare const __BUILD_TIME__: string;
