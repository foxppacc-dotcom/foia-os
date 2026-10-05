-- Discovered live while verifying this session's mailPoller.js changes: a
-- real IMAP poll against production failed to insert 3 genuine messages
-- (Microsoft SharePoint/OneDrive notification emails, which use unusually
-- long Message-ID headers) with "value too long for type character
-- varying(255)"/"...(100)". Since mailPoller.js only advances its
-- `last_checked` cursor when a poll has ZERO errors, this wasn't just 3 lost
-- messages -- every future poll would keep re-fetching and re-failing on
-- the exact same messages forever, never able to advance past them.
-- Email Message-ID/thread-id values have no real universal length cap in
-- practice (RFC 5322 doesn't hard-limit it), so TEXT (unbounded) is the
-- right type here, not a slightly-larger arbitrary varchar bound that could
-- just as easily be exceeded again by some other sender's mail system.
ALTER TABLE public.communications ALTER COLUMN message_id TYPE TEXT;
ALTER TABLE public.communications ALTER COLUMN thread_id TYPE TEXT;
