import { Episode } from '../../types/episode';
import { parseDuration } from './timeUtils';

/**
 * Normalise un objet brut d'épisode provenant de l'API ou du cache local.
 * Garantit la cohérence des champs (durée, mp3Link, etc.) pour l'application.
 * @param rawEpisode L'objet brut d'épisode à normaliser
 * @returns Un objet Episode normalisé
 */
export function normalizeEpisode(rawEpisode: any): Episode {
  return {
    id: rawEpisode.id,
    title: rawEpisode.title || 'Épisode',
    description: rawEpisode.description || '',
    originalMp3Link: rawEpisode.original_mp3_link || rawEpisode.originalMp3Link || '',
    mp3Link: rawEpisode.offline_path || rawEpisode.mp3Link || rawEpisode.mp3_link || '',
    duration: parseDuration(rawEpisode.duration),
    publicationDate: rawEpisode.publication_date || rawEpisode.publicationDate || new Date().toISOString(),
    offline_path: rawEpisode.offline_path || rawEpisode.filePath,
    artwork: rawEpisode.artwork || undefined,
  };
}

/**
 * Normalise un tableau d'épisodes bruts.
 * @param rawEpisodes Tableau d'objets bruts
 * @returns Tableau d'épisodes normalisés
 */
export function normalizeEpisodes(rawEpisodes: any[]): Episode[] {
  return rawEpisodes.map(normalizeEpisode);
}