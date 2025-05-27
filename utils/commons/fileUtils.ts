/**
 * Génère un nom de fichier à partir d'une URL.
 * Retourne un nom unique si l'URL est vide.
 * @param url L'URL source
 * @returns Le nom de fichier extrait ou généré
 */
export function getFilename(url: string | undefined): string {
  if (!url) return `episode-${Date.now()}.mp3`;
  return url.split('/').pop() || `episode-${Date.now()}.mp3`;
}

/**
 * Vérifie et crée le dossier de téléchargements si besoin.
 * @param downloadsDir Le chemin du dossier de téléchargements
 * @param FileSystem L'API FileSystem (injectée pour testabilité)
 * @returns Promise<boolean> true si le dossier existe ou a été créé
 */
export async function ensureDownloadsDirectory(downloadsDir: string, FileSystem: any): Promise<boolean> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(downloadsDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(downloadsDir, { intermediates: true });
    }
    return true;
  } catch (error) {
    console.error('Error creating downloads directory:', error);
    return false;
  }
}