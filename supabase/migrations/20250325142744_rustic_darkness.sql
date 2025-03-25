/*
  # Add watched episodes tracking

  1. New Tables
    - `watched_episodes`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `episode_id` (uuid, foreign key to episodes)
      - `watched_at` (timestamptz, default: now())

  2. Security
    - Enable RLS on `watched_episodes` table
    - Add policies for authenticated users to:
      - Read their own watched episodes
      - Insert new watched episodes
*/

CREATE TABLE IF NOT EXISTS watched_episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  episode_id uuid REFERENCES episodes NOT NULL,
  watched_at timestamptz DEFAULT now(),
  UNIQUE(user_id, episode_id)
);

ALTER TABLE watched_episodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own watched episodes"
  ON watched_episodes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own watched episodes"
  ON watched_episodes
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);