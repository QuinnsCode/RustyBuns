// What the page shows of content/posts.json. The editor (`bun run cms`) can change a post's words, its date and its
// `published` number, but never add a key, so a post goes up or down by its number: 1 shows it, 0 keeps it as a draft.
export interface Post { id: string; date: string; title: string; body: string; published: number }

/** The posts a reader sees: published ones, newest first. */
export const livePosts = (posts: readonly Post[]): Post[] =>
  posts.filter((p) => p.published > 0).sort((a, b) => b.date.localeCompare(a.date));
