export interface Episode {
  id: string;
  title: string;
  description?: string;
  mp3Link?: string;
  mp3_link?: string; // Pour compatibilité
  duration?: string;
  publicationDate?: string;
  publication_date?: string; // Pour compatibilité
  originalMp3Link?: string;
  // Pour les épisodes téléchargés localement
  offline_path?: string | null;
}