import { HELP_CATEGORIES, HELP_TOPICS, type HelpTopic } from '@/components/help/helpContent';

/**
 * The shape the Help section navigates by: the articles grouped into their
 * categories, in the order both are declared. Everything here is derived from
 * the Markdown files, so adding an article to `./topics` is all it takes for
 * it to appear in the sidebar, the index and the prev/next links.
 */
export type HelpGroup = {
  id: string;
  label: string;
  topics: HelpTopic[];
};

export const HELP_GROUPS: HelpGroup[] = HELP_CATEGORIES
  .map((category) => ({
    ...category,
    topics: HELP_TOPICS.filter((topic) => topic.category === category.id),
  }))
  .filter((group) => group.topics.length > 0);

/** Every article, flattened in sidebar order — what prev/next walk. */
export const HELP_ORDER: HelpTopic[] = HELP_GROUPS.flatMap((group) => group.topics);

/** The first article of the first category: where `/help` sends you. */
export const FIRST_TOPIC = HELP_ORDER[0];

const BY_ID = new Map(HELP_TOPICS.map((topic) => [topic.id, topic]));

export const findTopic = (id: string | undefined): HelpTopic | undefined => (
  id ? BY_ID.get(id) : undefined
);

/** The article before and after `id`, for the footer links of an article. */
export const neighboursOf = (id: string) => {
  const index = HELP_ORDER.findIndex((topic) => topic.id === id);
  return {
    previous: index > 0 ? HELP_ORDER[index - 1] : null,
    next: index >= 0 && index < HELP_ORDER.length - 1 ? HELP_ORDER[index + 1] : null,
  };
};

/** The label of the category an article belongs to. */
export const categoryLabelOf = (topic: HelpTopic): string => (
  HELP_CATEGORIES.find((category) => category.id === topic.category)?.label || ''
);

// Everything an article can be found by, lowercased once per topic.
const HAYSTACKS = new Map(
  HELP_TOPICS.map((topic) => [
    topic.id,
    [topic.title, topic.summary, topic.keywords.join(' '), topic.body].join(' ').toLowerCase(),
  ])
);

/** Articles matching every word of `query`; the whole set when it is empty. */
export const searchTopics = (query: string): HelpTopic[] => {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) { return HELP_TOPICS; }
  return HELP_TOPICS.filter((topic) => {
    const haystack = HAYSTACKS.get(topic.id) || '';
    return terms.every((term) => haystack.includes(term));
  });
};

/** `searchTopics`, kept grouped by category so the sidebar can render it. */
export const searchGroups = (query: string): HelpGroup[] => {
  const found = new Set(searchTopics(query).map((topic) => topic.id));
  return HELP_GROUPS
    .map((group) => ({ ...group, topics: group.topics.filter((topic) => found.has(topic.id)) }))
    .filter((group) => group.topics.length > 0);
};
