// The look of a rendered note: its own rules, and KaTeX's for formulas. The
// fonts are not here: a shadow root cannot load them, so the page declares
// them (see math.ts) or, in an export, carries them (mathFontCss).
import { katexRules } from './math';
import previewCss from './preview.css?inline';

export default `${previewCss}\n${katexRules}`;
