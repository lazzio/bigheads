export interface Database {
  public: {
    Tables: {
      episodes: {
        Row: {
          id: string;
          title: string;
          description: string;
          originalMp3Link: string;
          mp3Link: string;
          duration: number | null;
          publicationDate: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description: string;
          originalMp3Link: string;
          mp3Link: string;
          duration: number | null;
          publicationDate: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string;
          originalMp3Link?: string;
          mp3Link?: string;
          duration?: number | null;
          created_at?: string;
        };
      };
      watched_episodes: {
        Row: {
          id: string;
          user_id: string;
          episode_id: string;
          watched_at: string;
          playback_position: number | null;
          is_finished: boolean;
        };
        Insert: {
          id?: string;
          user_id: string;
          episode_id: string;
          watched_at?: string;
          playback_position?: number | null;
          is_finished?: boolean;
        };
        Update: {
          id?: string;
          user_id?: string;
          episode_id?: string;
          watched_at?: string;
          playback_position?: number | null;
          is_finished?: boolean;
        };
      };
    };
  };
}