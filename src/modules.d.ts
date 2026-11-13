declare module 'markdown-it-task-lists';
declare module 'markdown-it-footnote';
declare module '*.css?inline' {
  const css: string;
  export default css;
}
declare module '*.css?raw' {
  const css: string;
  export default css;
}
declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export const gfm: TurndownService.Plugin;
}
