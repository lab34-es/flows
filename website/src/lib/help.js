/**
 * The docs content is the Help section of the tool itself, imported verbatim
 * from the frontend source: one Markdown file per article, under
 * `frontend/src/components/help/topics`. Editing the in-app help
 * automatically updates the website on the next deploy — there is no second
 * copy to keep in sync.
 */
import {
  HELP_CATEGORIES,
  HELP_TOPICS,
} from '../../../frontend/src/components/help/helpContent';

export { HELP_CATEGORIES, HELP_TOPICS };

/** Topics grouped by category, in the order both are declared. */
export const groupedTopics = HELP_CATEGORIES.map((category) => ({
  ...category,
  topics: HELP_TOPICS.filter((topic) => topic.category === category.id),
})).filter((category) => category.topics.length > 0);

/** Every topic, flattened in sidebar order (used for prev/next links). */
export const orderedTopics = groupedTopics.flatMap((category) =>
  category.topics.map((topic) => ({ ...topic, categoryLabel: category.label })),
);

/** Prefix a root-relative path with the deploy base (GitHub Pages subpath). */
export function withBase(path) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path}`;
}
