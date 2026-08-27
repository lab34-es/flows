/**
 * The content of the Help section: a set of articles rendered as Markdown.
 *
 * Every article is one Markdown file in `./topics`, with its metadata in the
 * frontmatter — the same shape flows themselves use. This module only loads
 * them, sorts them and hands them over; nothing here needs editing to add,
 * remove or reorder an article.
 *
 * Every article is searchable by title, summary, keywords and body, so keep
 * the keywords list close to the words someone would actually type.
 *
 * `icon` is a key of the ICONS map in `./icons.ts`.
 *
 * The same articles are the source of the documentation website, which imports
 * this module from `website/src/lib/help.js`.
 */

export type HelpCategory = {
  id: string;
  label: string;
};

export type HelpTopic = {
  /** The file name, without extension — also the URL slug on the website. */
  id: string;
  category: string;
  icon: string;
  title: string;
  summary: string;
  keywords: string[];
  /** Position inside its category. */
  order: number;
  /** The Markdown body, frontmatter stripped. */
  body: string;
};

export const HELP_CATEGORIES: HelpCategory[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'writing', label: 'Writing flows' },
  { id: 'reference', label: 'Reference' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'running', label: 'Running' },
  { id: 'help', label: 'Help & support' },
];

/** `'it''s'` → `it's`; bare scalars are taken verbatim. */
const unquote = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length > 1) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  return trimmed;
};

/**
 * The subset of YAML the help frontmatter uses: `key: scalar`, `key: [a, b]`
 * and block sequences of scalars. Nothing else is needed, and anything else
 * would be a sign the metadata is growing beyond what an article should carry.
 */
const parseFrontmatter = (source: string): { data: Record<string, string | string[]>; body: string } => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) { return { data: {}, body: source }; }

  const data: Record<string, string | string[]> = {};
  let key: string | null = null;

  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) { continue; }

    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && key) {
      (data[key] as string[]).push(unquote(item[1]));
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) { continue; }

    const [, name, rest] = pair;
    key = name;
    if (rest === '') {
      data[name] = [];
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      data[name] = rest.slice(1, -1).split(',').map(unquote).filter(Boolean);
      key = null;
    } else {
      data[name] = unquote(rest);
      key = null;
    }
  }

  return { data, body: source.slice(match[0].length) };
};

// Eager + raw so the articles are bundled as plain strings at build time, both
// in the app (Vite) and on the website (Astro), with no runtime fetching.
const FILES = import.meta.glob('./topics/*.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

const CATEGORY_ORDER = new Map(HELP_CATEGORIES.map((category, index) => [category.id, index]));

const asArray = (value: string | string[] | undefined): string[] => {
  if (Array.isArray(value)) { return value; }
  return value ? [value] : [];
};

export const HELP_TOPICS: HelpTopic[] = Object.entries(FILES)
  .map(([file, source]) => {
    const { data, body } = parseFrontmatter(source);
    return {
      id: file.replace(/^.*\//, '').replace(/\.md$/, ''),
      category: String(data.category ?? ''),
      icon: String(data.icon ?? 'file'),
      title: String(data.title ?? ''),
      summary: String(data.summary ?? ''),
      keywords: asArray(data.keywords),
      order: Number(data.order ?? 0),
      body: body.trim(),
    };
  })
  .sort((a, b) => {
    const category = (CATEGORY_ORDER.get(a.category) ?? Number.MAX_SAFE_INTEGER)
      - (CATEGORY_ORDER.get(b.category) ?? Number.MAX_SAFE_INTEGER);
    return category !== 0 ? category : a.order - b.order || a.id.localeCompare(b.id);
  });

export default HELP_TOPICS;
