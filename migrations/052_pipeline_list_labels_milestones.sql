-- Per-list labels and milestones for the production pipeline ("خط الإنتاج").
-- Every pipeline list owns its own label set and milestone set (list_id), so a
-- brand-new list automatically gets both, empty and ready to configure from
-- inside the list itself. Cards are `requests` rows: a card can carry many
-- labels (request_labels) and one milestone (requests.milestone_id).
-- Labels/milestones are soft-deleted (deleted_at) and ordered by sort_order,
-- same shape as checklist_templates.
CREATE TABLE IF NOT EXISTS public.pipeline_list_labels (
  id BIGSERIAL PRIMARY KEY,
  list_id BIGINT NOT NULL REFERENCES public.pipeline_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6B7280',
  sort_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pipeline_list_milestones (
  id BIGSERIAL PRIMARY KEY,
  list_id BIGINT NOT NULL REFERENCES public.pipeline_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6B7280',
  sort_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.request_labels (
  request_id BIGINT NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  label_id BIGINT NOT NULL REFERENCES public.pipeline_list_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (request_id, label_id)
);

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS milestone_id BIGINT REFERENCES public.pipeline_list_milestones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_list_labels_list ON public.pipeline_list_labels (list_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pipeline_list_milestones_list ON public.pipeline_list_milestones (list_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_request_labels_label ON public.request_labels (label_id);
CREATE INDEX IF NOT EXISTS idx_requests_milestone ON public.requests (milestone_id) WHERE milestone_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_list_labels TO web_anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_list_milestones TO web_anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.request_labels TO web_anon;
GRANT USAGE, SELECT ON SEQUENCE public.pipeline_list_labels_id_seq TO web_anon;
GRANT USAGE, SELECT ON SEQUENCE public.pipeline_list_milestones_id_seq TO web_anon;

NOTIFY pgrst, 'reload schema';
