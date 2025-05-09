import { ImageSourcePropType } from 'react-native';

export interface Episode {
  id: string;
  title: string;
  description: string;
  originalMp3Link?: string;
  mp3Link: string;
  duration: number | null;
  publicationDate: string;
  offline_path?: string;
  artwork: ImageSourcePropType | undefined;
}