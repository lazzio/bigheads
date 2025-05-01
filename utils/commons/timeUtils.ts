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