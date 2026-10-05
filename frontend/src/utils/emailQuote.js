// Splits a plain-text email body into "what this person actually wrote" and
// the older quoted conversation trailing after it -- the same split every
// real mail client (Gmail/Outlook) makes to show old history collapsed
// instead of at full size/prominence alongside the new text. Finds whichever
// quote marker appears FIRST in the raw string (our own quoteReply()
// attribution line "في <date>, كتب <sender>:", our own forward banner, a
// real external client's "On ... wrote:", or two-or-more consecutive "> "
// quote-prefixed lines) and cuts there -- deliberately based on string
// position rather than requiring the text to already contain real line
// breaks at that point, since a deeply nested reply chain (this app's own
// quoteReply nested inside itself repeatedly) can arrive with the whole
// history run together with no visual separation at all otherwise.
//
// The "> " marker specifically requires TWO consecutive quoted lines, not
// just one -- a single line starting with ">" can legitimately appear in a
// genuine, non-quoted message (a markdown blockquote, a pasted code snippet,
// a plain comparison like "> 1000"), and treating that alone as the start of
// quoted history would wrongly cut off real content the sender actually
// wrote. A real quoted block from any mail client always spans multiple
// lines (the original message being quoted is essentially never one line),
// so requiring two in a row keeps the marker specific to actual quotes.
//
// Shared by EmailBodyView.jsx (reading an email -- shows the quoted part
// collapsed) and CommunicationCenter.jsx's quoteReply (composing a reply --
// only the fresh part gets re-quoted, instead of re-sending the whole
// accumulated chain of "> "-prefixed history back out).
export function splitQuotedHistory(text) {
  if (!text) return { fresh: text || '', quoted: '' };
  const markers = [
    /(^|\n)\s*في .+?[,،] *كتب .+?:/,
    /(^|\n)-{5,}\s*رسالة معاد توجيهها\s*-{5,}/,
    /(^|\n)\s*On .+? wrote:/i,
    /(^|\n)\s*-{3,}\s*Original Message\s*-{3,}/i,
    /(^|\n)>[^\n]*\n>/,
  ];
  let cutIndex = -1;
  for (const re of markers) {
    const m = text.match(re);
    if (m && m.index != null && (cutIndex === -1 || m.index < cutIndex)) cutIndex = m.index;
  }
  if (cutIndex <= 0) return { fresh: text, quoted: '' };
  return { fresh: text.slice(0, cutIndex).trimEnd(), quoted: text.slice(cutIndex).trim() };
}
