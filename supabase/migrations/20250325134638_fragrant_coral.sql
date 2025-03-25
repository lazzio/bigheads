/*
  # Create episodes table

  1. New Tables
    - `episodes`
      - `id` (uuid, primary key)
      - `title` (text, not null)
      - `audio_url` (text, not null)
      - `publication_date` (date, not null)
      - `source` (text, not null)
      - `source_url` (text)
      - `created_at` (timestamptz, default: now())

  2. Security
    - Enable RLS on `episodes` table
    - Add policy for public read access
*/

CREATE TABLE IF NOT EXISTS episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  audio_url text NOT NULL,
  publication_date date NOT NULL,
  source text NOT NULL,
  source_url text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access"
  ON episodes
  FOR SELECT
  TO public
  USING (true);