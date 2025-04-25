export interface Episode {
  id: string;
  title: string;
  description: string;
  originalMp3Link?: string; // Keep original link if needed
  mp3Link: string; // The link to be used by the player (could be GCP or original)
  duration: string | number; // Can be string ('HH:MM:SS') or number (seconds)
  publicationDate: string; // ISO Date string
  offline_path?: string; // Path to the downloaded file
  // Add any other relevant fields like image URL if available
  artworkUrl?: string; 
}