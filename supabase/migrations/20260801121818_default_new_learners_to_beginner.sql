-- Q2: A new learner should receive beginner-level teaching until they
-- explicitly choose a different tutoring style. Existing choices are kept.
ALTER TABLE public.user_preferences
  ALTER COLUMN persona SET DEFAULT 'beginner';
