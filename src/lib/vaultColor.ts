// Tints of the theme's text, accent and syntax colours, to tell vaults apart
// in the sidebar and on the start screen.
const COLORS = ['--accent', '--syn-string', '--syn-attr', '--syn-number', '--syn-keyword', '--text-2'];

export const vaultColor = (id: string) => `var(${COLORS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length]})`;
