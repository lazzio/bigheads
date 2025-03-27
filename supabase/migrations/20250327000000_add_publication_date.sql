/*
  # Add publication_date column to episodes table
  
  1. Changes
    - Add publication_date column as temporarily nullable
    - Set default values for existing rows
    - Make column NOT NULL after data migration
    
  2. Security
    - Maintain existing RLS policies
*/

-- Add the publication_date column as nullable first
ALTER TABLE episodes
ADD COLUMN IF NOT EXISTS publication_date text;

-- Set a default value for existing rows (current date)
UPDATE episodes
SET publication_date = to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD:HH24:MI:SS')
WHERE publication_date IS NULL;

-- Make the column NOT NULL after setting default values
ALTER TABLE episodes
ALTER COLUMN publication_date SET NOT NULL;

-- Add a comment to the column
COMMENT ON COLUMN episodes.publication_date IS 'Publication date of the episode in YYYY-MM-DD format';
