// Les anciennes fonctions formatTime, durationToSeconds, parseDuration, isValidAudioUrl, normalizeAudioUrl sont maintenant centralisées ci-dessus.
// Vous pouvez supprimer ces anciennes fonctions si elles ne sont plus nécessaires.

/**
 * Formats time in seconds to a MM:SS or HH:MM:SS string.
 */
export function formatTime(timeInSeconds: number): string {
    const totalSeconds = Math.floor(timeInSeconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
  
    const secondsStr = seconds < 10 ? `0${seconds}` : `${seconds}`;
    const minutesStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
  
    if (hours > 0) {
      const hoursStr = hours < 10 ? `0${hours}` : `${hours}`;
      return `${hoursStr}:${minutesStr}:${secondsStr}`;
    } else {
      return `${minutesStr}:${secondsStr}`;
    }
  }
  
  /**
   * Converts duration string (HH:MM:SS or MM:SS) to seconds.
   * Returns 0 if format is invalid.
   */
  export function durationToSeconds(durationStr: string | number | undefined | null): number {
    if (typeof durationStr === 'number') {
      return Math.floor(durationStr);
    }
    if (typeof durationStr !== 'string' || !durationStr) {
      return 0;
    }
  
    const parts = durationStr.split(':').map(Number);
    let seconds = 0;
  
    if (parts.length === 3) {
      // HH:MM:SS
      if (parts.some(isNaN)) return 0;
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      // MM:SS
      if (parts.some(isNaN)) return 0;
      seconds = parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
       // Assume seconds only
       if (isNaN(parts[0])) return 0;
       seconds = parts[0];
    }
  
    return Math.floor(seconds);
  }

  /**
   * Analyzes a duration expressed as a string (e.g. "01:23:45", "12:34", or "56")
   * or as a number, and converts it to a number of seconds.
   *
   * @param durationStr - The duration to analyze, as a string (format "HH:MM:SS", "MM:SS", or "SS") or as a number (seconds).
   * @returns The number of seconds corresponding to the duration, or `null` if the input is not valid.
   *
   * @example
   * parseDuration("01:02:03"); // Returns 3723
   * parseDuration("12:34");    // Returns 754
   * parseDuration("56");       // Returns 56
   * parseDuration(120);        // Returns 120
   * parseDuration(null);       // Returns null
   */
  export function parseDuration(durationStr: string | number | null): number | null {
    if (typeof durationStr === 'number') return durationStr;
    if (typeof durationStr !== 'string' || !durationStr) return null;
    const parts = durationStr.split(':').map(Number);
    let seconds = 0;
    if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    else if (parts.length === 1 && !isNaN(parts[0])) seconds = parts[0];
    return isNaN(seconds) ? null : seconds;
  }

/**
 * Vérifie si une URL audio est valide (commence par http(s) ou file).
 * @param url L'URL à vérifier
 * @returns true si l'URL est valide
 */
export function isValidAudioUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\//.test(url) || url.startsWith('file:');
}

/**
 * Normalise une URL audio (supprime les espaces, etc.).
 * @param url L'URL à normaliser
 * @returns L'URL normalisée ou une chaîne vide
 */
export function normalizeAudioUrl(url: string | undefined): string {
  if (!url) return '';
  return url.trim().replace(/ /g, '%20');
}