// The card a free limit shows (the decks when a set is refused or ends, a listener's page when the set is full): which
// limit, in plain words, and the paid waitlist's sign-up, the same /signup the full card posts to (src/signup-wire.ts).
import "./waitlist.css";
import { signUp } from "../signup-wire.ts";
import { limitSays, type Limit } from "./live-wire.ts";

/** The card for `why` (its number `n`); `room` goes with the sign-up, so the list says where it came from. */
export function waitlistCard(why: Limit, n: number, room = "live"): HTMLElement {
  const { title, says } = limitSays(why, n);
  const card = document.createElement("div");
  card.className = "waitlist";
  card.setAttribute("role", "status");
  card.dataset.limit = why;
  const h = document.createElement("h3"), p = document.createElement("p"), paid = document.createElement("p");
  h.textContent = title;
  p.textContent = says;
  paid.className = "waitlist-paid";
  paid.textContent = "Paid is coming: join the waitlist";
  const form = document.createElement("form"), email = document.createElement("input"), go = document.createElement("button"), err = document.createElement("p");
  email.type = "email"; email.required = true; email.placeholder = "you@example.com"; email.setAttribute("aria-label", "Email");
  go.type = "submit"; go.textContent = "Join";
  err.className = "waitlist-err";
  form.append(email, go);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    go.disabled = true; err.textContent = "";
    void signUp(email.value, room, "paid").then((r) => {
      go.disabled = false;
      if ("place" in r) { const done = document.createElement("p"); done.textContent = `You're on the waitlist, number ${r.place}.`; form.replaceWith(done); }
      else err.textContent = r.error;
    });
  });
  card.append(h, p, paid, form, err);
  return card;
}
