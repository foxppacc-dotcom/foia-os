-- "مركز الخبرة والتدريب" -- per-capability instructions/training text an
-- admin feeds the assistant, plus a separate field the assistant itself
-- accumulates experience into over time. Deliberately stored independently
-- of any provider config: this is what carries over when the active AI
-- provider is switched (Claude -> GPT -> DeepSeek -> Gemini, or back), so
-- whichever provider is active next picks up from the same accumulated
-- level instead of starting cold.
CREATE TABLE IF NOT EXISTS public.ai_capability_knowledge (
  action text PRIMARY KEY,
  instructions text,
  learned_notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
