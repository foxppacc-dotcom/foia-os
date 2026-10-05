import { useState, useMemo, useCallback } from 'react';
import { splitQuotedHistory } from '../utils/emailQuote';

// Force every link to open in a new tab regardless of what the source email
// set (most don't set target at all) -- otherwise a click inside the
// sandboxed iframe below would try to navigate the iframe itself and,
// without allow-top-navigation, silently do nothing. DOMParser only parses;
// it never executes embedded <script> or runs on* handlers, so this is safe
// to do on fully untrusted inbound HTML.
function forceLinksNewTab(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('a[href]').forEach(a => {
      // Inbound mail is untrusted: drop any link that isn't plain http(s)/mailto/tel
      // (javascript:, data:, vbscript: ...) instead of leaving it clickable.
      if (!/^\s*(https?:|mailto:|tel:|#)/i.test(a.getAttribute('href') || '')) a.removeAttribute('href');
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
    return doc.documentElement.outerHTML;
  } catch {
    return html;
  }
}

// Renders an email's body faithfully -- matching how it looked at the
// source (clickable links, portal "ادخل البوابة" buttons, layout) -- while
// staying safe against fully untrusted inbound content. The iframe sandbox
// deliberately has NO allow-scripts (an embedded <script> or onclick never
// executes) and NO allow-forms (a portal "login" form embedded in an email
// can't submit anywhere from inside our own app). allow-popups is included
// specifically so the forced target="_blank" links above actually open.
export default function EmailBodyView({ html, text }) {
  const [height, setHeight] = useState(160);
  const [quotedOpen, setQuotedOpen] = useState(false);
  const processedHtml = useMemo(() => (html ? forceLinksNewTab(html) : null), [html]);
  const { fresh, quoted } = useMemo(() => splitQuotedHistory(text), [text]);

  const onLoad = useCallback((e) => {
    try {
      const doc = e.target.contentDocument;
      if (doc?.body) setHeight(Math.min(Math.max(doc.body.scrollHeight + 24, 120), 2400));
    } catch { /* cross-origin resources inside the email body -- keep current height */ }
  }, []);

  if (!processedHtml) {
    return (
      <div className="rounded-lg p-3.5 text-sm leading-relaxed select-text"
        style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-primary)' }}>
        <div className="whitespace-pre-wrap">{fresh || '(لا يوجد محتوى)'}</div>
        {quoted && (
          <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--ds-border)' }}>
            <button type="button" onClick={() => setQuotedOpen(o => !o)}
              className="text-xs ds-transition-colors" style={{ color: 'var(--ds-text-muted)' }}>
              {quotedOpen ? '▲ إخفاء النص المقتبس' : '▾ عرض النص المقتبس'}
            </button>
            {quotedOpen && (
              <div className="mt-2 whitespace-pre-wrap text-xs" style={{ color: 'var(--ds-text-muted)' }}>{quoted}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <iframe
      title="email-body"
      srcDoc={processedHtml}
      onLoad={onLoad}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="w-full rounded-lg"
      style={{ height, border: '1px solid var(--ds-border)', background: 'white' }}
    />
  );
}
