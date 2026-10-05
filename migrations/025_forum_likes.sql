CREATE TABLE IF NOT EXISTS public.forum_likes (
  id serial PRIMARY KEY,
  target_type text NOT NULL CHECK (target_type IN ('topic', 'comment')),
  target_id integer NOT NULL,
  user_id integer REFERENCES public.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(target_type, target_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_likes_target ON public.forum_likes(target_type, target_id);
