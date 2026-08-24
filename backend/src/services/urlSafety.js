// Guards every place a user-supplied "link attachment" URL gets stored and
// later rendered as a real <a href> with no further sanitization (forum
// topics/comments, case team-discussion comments). Without this, a
// javascript:/data:/vbscript: URI stored verbatim executes in the app's own
// origin the moment any teammate clicks the attacker-labelled link --
// rel="noopener noreferrer" does nothing to stop that, only http(s) is safe
// to store as a clickable link here.
function isSafeLinkUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  return /^https?:\/\//i.test(url.trim());
}

module.exports = { isSafeLinkUrl };
