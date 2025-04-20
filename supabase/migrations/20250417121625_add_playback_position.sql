-- Add playback_position column to watched_episodes table
ALTER TABLE public.watched_episodes
ADD COLUMN playback_position numeric;

-- Add a comment to the new column
COMMENT ON COLUMN public.watched_episodes.playback_position IS 'Stores the last playback position in seconds for the episode';

-- Optional: Update existing policies if needed, though the existing ones might suffice
-- Example: Ensure users can update their own playback position
DROP POLICY IF EXISTS "Users can insert their own watched episodes" ON public.watched_episodes;
CREATE POLICY "Users can insert or update their own watched episodes"
  ON public.watched_episodes
  FOR ALL -- Changed from INSERT to ALL to allow updates
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Ensure the SELECT policy still works
DROP POLICY IF EXISTS "Users can read their own watched episodes" ON public.watched_episodes;
CREATE POLICY "Users can read their own watched episodes"
  ON public.watched_episodes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);