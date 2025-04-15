-- Cette fonction est appelée quand un nouvel épisode est créé
CREATE OR REPLACE FUNCTION notify_new_episode()
RETURNS TRIGGER AS $$
BEGIN
  -- Appeler l'Edge Function pour envoyer les notifications
  PERFORM http_post(
    'https://your-project-ref.supabase.co/functions/v1/send-episode-notifications',
    json_build_object('episode', row_to_json(NEW)),
    'application/json'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Créer le trigger sur la table episodes
CREATE TRIGGER episode_notification_trigger
AFTER INSERT ON episodes
FOR EACH ROW
EXECUTE FUNCTION notify_new_episode();