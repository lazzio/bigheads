-- Add is_finished column to watched_episodes table
ALTER TABLE public.watched_episodes
ADD COLUMN is_finished BOOLEAN NOT NULL DEFAULT FALSE;

-- Add a comment for clarity
COMMENT ON COLUMN public.watched_episodes.is_finished IS 'Indicates if the episode playback was completed by the user';

-- Ensure RLS policies allow updating this new column
-- If using the combined policy from previous steps, it should already allow UPDATE.
-- If using separate policies, ensure the UPDATE policy includes 'is_finished'.

-- Example: Re-creating a combined policy (if needed, adjust names)
DROP POLICY IF EXISTS "Users can manage their own watched episodes" ON public.watched_episodes;

CREATE POLICY "Users can manage their own watched episodes"
  ON public.watched_episodes
  FOR ALL -- Allows SELECT, INSERT, UPDATE, DELETE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);