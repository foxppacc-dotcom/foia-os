-- Profile.jsx's own edit form has always had a "نبذة مختصرة" (bio) textarea,
-- but users.bio never existed as a column -- GET /profile/:id couldn't
-- select it and PUT /profile/:id couldn't save it, so that one field of the
-- edit form was a silent no-op (looked like it saved, never actually did).
-- phone/job_title/department already existed as real columns; only bio was
-- missing.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bio text;
