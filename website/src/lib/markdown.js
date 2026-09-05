import { Marked } from 'marked';
import { withBase } from './help.js';

/**
 * Callout types, in the GitHub / Obsidian `> [!NOTE]` syntax. The app renders
 * the same markers (see frontend/src/lib/remark-callouts.ts); the icons below
 * are the lucide glyphs it uses, inlined because the docs site ships no icon
 * library.
 */
const CALLOUTS = {
  note: { label: 'Note', icon: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>' },
  tip: {
    label: 'Tip',
    icon: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  },
  important: {
    label: 'Important',
    icon: '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M12 15h.01"/><path d="M12 7v4"/>',
  },
  warning: {
    label: 'Warning',
    icon: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  },
  caution: {
    label: 'Caution',
    icon: '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>',
  },
};

// The marker opens the quote and may carry a custom title on the same line.
const MARKER = new RegExp(`^\\[!(${Object.keys(CALLOUTS).join('|')})\\][ \\t]*([^\\n]*)(?:\\n|$)`, 'i');

const escapeHtml = (value) =>
  value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

const marked = new Marked({
  gfm: true,
  renderer: {
    // A blockquote opening with `[!TYPE]` becomes a callout; every other one
    // is left to the default renderer.
    blockquote(token) {
      const match = MARKER.exec(token.text);
      if (!match) return false;

      const type = match[1].toLowerCase();
      const { label, icon } = CALLOUTS[type];
      const title = match[2].trim() || label;
      const body = this.parser.parse(marked.lexer(token.text.slice(match[0].length)));

      return [
        `<div class="callout" data-callout="${type}">`,
        `<p class="callout-title">`,
        `<svg class="callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`,
        escapeHtml(title),
        `</p>${body}</div>`,
      ].join('');
    },
    // Articles link to each other the way the app does, as `/help/<id>`; here
    // the same article is `/docs/<id>/`. The token is rewritten and left to
    // the default renderer.
    link(token) {
      const match = /^\/help\/([^/#?]+)\/?(#.*)?$/.exec(token.href || '');
      if (!match) return false;
      token.href = withBase(`/docs/${match[1]}/${match[2] || ''}`);
      return false;
    },
  },
});

/** Render a help article body (Markdown) to HTML. */
export function renderMarkdown(markdown) {
  return marked.parse(markdown.trim());
}
