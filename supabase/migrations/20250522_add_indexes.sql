-- Migration: Ajout d'indexes pour accélérer les accès critiques (episodes, watched_episodes)
-- Date: 2025-05-22

-- Table: episodes
CREATE INDEX IF NOT EXISTS idx_episodes_publication_date ON episodes(publication_date DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_mp3_link ON episodes(mp3_link);

-- Table: watched_episodes
CREATE UNIQUE INDEX IF NOT EXISTS idx_watched_episodes_user_episode ON watched_episodes(user_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_watched_episodes_user_id ON watched_episodes(user_id);
CREATE INDEX IF NOT EXISTS idx_watched_episodes_episode_id ON watched_episodes(episode_id);
CREATE INDEX IF NOT EXISTS idx_watched_episodes_is_finished ON watched_episodes(is_finished);
CREATE INDEX IF NOT EXISTS idx_watched_episodes_watched_at ON watched_episodes(watched_at DESC);
