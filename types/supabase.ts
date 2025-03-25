export interface Database {
  public: {
    Tables: {
      episodes: {
        Row: {
          id: string;
          title: string;
          audio_url: string;
          publication_date: string;
          source: string;
          source_url: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          audio_url: string;
          publication_date: string;
          source: string;
          source_url: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          audio_url?: string;
          publication_date?: string;
          source?: string;
          source_url?: string;
          created_at?: string;
        };
      };
      watched_episodes: {
        Row: {
          id: string;
          user_id: string;
          episode_id: string;
          watched_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          episode_id: string;
          watched_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          episode_id?: string;
          watched_at?: string;
        };
      };
    };
  };
}