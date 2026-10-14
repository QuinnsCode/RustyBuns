// The markup of the home page's favourite-features vote. assets/votes.js fills it in: the tier list
// from data-features, the staircase from /api/votes.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function voteSection(features: { slug: string; title: string }[]) {
  return `<section class="vote" id="vote" aria-labelledby="vote-h" data-features="${esc(JSON.stringify(features))}">
<h2 id="vote-h">Vote for your favorite features</h2>
<p>Drag features into tiers (or pick one and press <kbd>S</kbd> <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd>), add a comment and send it. Votes and comments are public, and the stage below cycles through the last 50, one a second.</p>
<noscript><p>The vote needs JavaScript.</p></noscript>
<div class="stage-wrap">
  <canvas class="stage" width="900" height="320" aria-hidden="true"></canvas>
  <div class="stage-bar">
    <span class="beat" aria-hidden="true"></span>
    <button type="button" data-act="prev" aria-label="Previous vote" title="Previous vote">&#9664;</button>
    <button type="button" data-act="play" aria-label="Pause" title="Pause">&#10074;&#10074;</button>
    <button type="button" data-act="next" aria-label="Next vote" title="Next vote">&#9654;</button>
    <span class="now" aria-live="off">No votes yet, be the first.</span>
  </div>
  <blockquote class="said" hidden></blockquote>
  <ol class="order" aria-label="Features in the order of the vote on stage"></ol>
</div>
<form class="ballot" aria-label="Your ranking">
  <div class="tiers"></div>
  <label>Why? <textarea name="comment" maxlength="280" rows="2" placeholder="Optional, 280 characters"></textarea></label>
  <button type="submit">Send my ranking</button>
  <span class="sent" role="status" aria-live="polite"></span>
</form>
</section>`;
}
