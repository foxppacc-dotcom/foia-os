-- Team discussion: replies + directed mentions
ALTER TABLE public.case_comments
  ADD COLUMN IF NOT EXISTS reply_to_id integer REFERENCES public.case_comments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mentioned_user_ids integer[] DEFAULT '{}';

-- General Forum: org-wide discussion + announcements, not tied to any case
CREATE TABLE IF NOT EXISTS public.forum_topics (
  id serial PRIMARY KEY,
  title text NOT NULL,
  body text,
  is_pinned boolean DEFAULT false,
  is_announcement boolean DEFAULT false,
  attachment_url text,
  attachment_type text,
  attachment_name text,
  created_by integer REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.forum_comments (
  id serial PRIMARY KEY,
  topic_id integer NOT NULL REFERENCES public.forum_topics(id) ON DELETE CASCADE,
  content text,
  attachment_url text,
  attachment_type text,
  attachment_name text,
  created_by integer REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forum_comments_topic ON public.forum_comments(topic_id);
CREATE INDEX IF NOT EXISTS idx_forum_topics_pinned ON public.forum_topics(is_pinned, created_at DESC);
