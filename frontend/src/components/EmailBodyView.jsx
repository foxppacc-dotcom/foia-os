import { useState, useMemo, useCallback } from 'react';

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
  const processedHtml = useMemo(() => (html ? forceLinksNewTab(html) : null), [html]);

  const onLoad = useCallback((e) => {
    try {
      const doc = e.target.contentDocument;
      if (doc?.body) setHeight(Math.min(Math.max(doc.body.scrollHeight + 24, 120), 2400));
    } catch { /* cross-origin resources inside the email body -- keep current height */ }
  }, []);

  if (!processedHtml) {
    return (
      <div className="rounded-lg p-3.5 text-sm leading-relaxed whitespace-pre-wrap select-text"
        style={{ background: 'var(--ds-bg-tertiary)', color: 'var(--ds-text-primary)' }}>
        {text || '(لا يوجد محتوى)'}
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
