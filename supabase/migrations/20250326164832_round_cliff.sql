/*
  # Update episodes table schema

  1. Changes
    - Remove existing columns
    - Add new columns with temporary nullable constraints
    - Update constraints after data migration

  2. Security
    - Maintain existing RLS policies
*/

-- Create new columns as nullable first
ALTER TABLE episodes
ADD COLUMN IF NOT EXISTS title text,
ADD COLUMN IF NOT EXISTS original_mp3_link text,
ADD COLUMN IF NOT EXISTS duration text,
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS mp3_link text;

-- Migrate data from old columns to new ones
UPDATE episodes
SET title = COALESCE(title, 'Untitled Episode'),
    original_mp3_link = COALESCE(audio_url, ''),
    mp3_link = COALESCE(audio_url, ''),
    duration = '00:00',
    description = COALESCE('Episode from ' || source, 'No description available');

-- Now make the columns NOT NULL after data migration
ALTER TABLE episodes
ALTER COLUMN title SET NOT NULL,
ALTER COLUMN original_mp3_link SET NOT NULL,
ALTER COLUMN duration SET NOT NULL,
ALTER COLUMN description SET NOT NULL,
ALTER COLUMN mp3_link SET NOT NULL;

-- Finally, drop the old columns
ALTER TABLE episodes
DROP COLUMN IF EXISTS audio_url,
DROP COLUMN IF EXISTS publication_date,
DROP COLUMN IF EXISTS source,
DROP COLUMN IF EXISTS source_url;