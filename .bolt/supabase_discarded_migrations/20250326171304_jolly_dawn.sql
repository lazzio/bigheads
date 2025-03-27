/*
  # Create restore point

  1. Changes
    - Creates a backup table `episodes_backup` with all current data
    - Adds timestamp to track when the backup was created
  
  2. Security
    - Enables RLS on backup table
    - Adds policy for admin access only
*/

-- Create backup table with same structure as episodes
CREATE TABLE IF NOT EXISTS episodes_backup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  original_mp3_link text NOT NULL,
  duration text NOT NULL,
  description text NOT NULL,
  mp3_link text NOT NULL,
  created_at timestamptz DEFAULT now(),
  backup_created_at timestamptz DEFAULT now()
);

-- Copy all data from episodes to backup
INSERT INTO episodes_backup (
  id,
  title,
  original_mp3_link,
  duration,
  description,
  mp3_link,
  created_at
)
SELECT 
  id,
  title,
  original_mp3_link,
  duration,
  description,
  mp3_link,
  created_at
FROM episodes;

-- Enable RLS on backup table
ALTER TABLE episodes_backup ENABLE ROW LEVEL SECURITY;

-- Add policy for admin access only
CREATE POLICY "Allow admin full access" 
  ON episodes_backup
  FOR ALL 
  TO authenticated
  USING (auth.uid() IN (
    SELECT auth.uid() 
    FROM auth.users 
    WHERE auth.email() = ANY(ARRAY['admin@example.com'])
  ));