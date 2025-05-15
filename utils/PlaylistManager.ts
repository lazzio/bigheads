// utils/PlaylistManager.ts
import { Episode } from '../types/episode';

/**
 * PlaylistManager gère la navigation dans une liste d'épisodes (playlist).
 * Il ne gère pas la lecture audio, seulement la logique de navigation (next/previous/current).
 */
export class PlaylistManager {
  private episodes: Episode[] = [];
  private currentIndex: number = -1;

  constructor(episodes: Episode[] = [], startIndex: number = 0) {
    this.setEpisodes(episodes, startIndex);
  }

  setEpisodes(episodes: Episode[], startIndex: number = 0) {
    this.episodes = episodes;
    this.currentIndex = Math.min(Math.max(0, startIndex), episodes.length - 1);
  }

  getCurrent(): Episode | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.episodes.length) {
      return this.episodes[this.currentIndex];
    }
    return null;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getEpisodes(): Episode[] {
    return this.episodes;
  }

  hasNext(): boolean {
    return this.episodes.length > 0 && this.currentIndex < this.episodes.length - 1;
  }

  hasPrevious(): boolean {
    return this.episodes.length > 0 && this.currentIndex > 0;
  }

  next(): Episode | null {
    if (this.hasNext()) {
      this.currentIndex++;
      return this.getCurrent();
    }
    return null;
  }

  previous(): Episode | null {
    if (this.hasPrevious()) {
      this.currentIndex--;
      return this.getCurrent();
    }
    return null;
  }

  goTo(index: number): Episode | null {
    if (index >= 0 && index < this.episodes.length) {
      this.currentIndex = index;
      return this.getCurrent();
    }
    return null;
  }
}

// Singleton exporté pour usage global
export const playlistManager = new PlaylistManager();
