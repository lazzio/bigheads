/**
 * Convertit une couleur web (hex, rgb, rgba) en valeur ARGB numérique
 * @param color Couleur au format '#RRGGBB', '#RGB', 'rgb(r,g,b)' ou 'rgba(r,g,b,a)'
 * @returns Valeur numérique au format ARGB
 */
export function webColorToArgbNumber(color: string): number {
    let r = 0, g = 0, b = 0, a = 255; // Alpha par défaut à 255 (opaque)
    
    // Gestion des formats hexadécimaux
    if (color.startsWith('#')) {
      if (color.length === 4) { // Format #RGB
        r = parseInt(color[1] + color[1], 16);
        g = parseInt(color[2] + color[2], 16);
        b = parseInt(color[3] + color[3], 16);
      } else if (color.length === 7) { // Format #RRGGBB
        r = parseInt(color.substring(1, 3), 16);
        g = parseInt(color.substring(3, 5), 16);
        b = parseInt(color.substring(5, 7), 16);
      } else if (color.length === 9) { // Format #AARRGGBB
        a = parseInt(color.substring(1, 3), 16);
        r = parseInt(color.substring(3, 5), 16);
        g = parseInt(color.substring(5, 7), 16);
        b = parseInt(color.substring(7, 9), 16);
      } else {
        throw new Error('Format hexadécimal invalide');
      }
    } 
    // Gestion des formats rgb et rgba
    else if (color.startsWith('rgb')) {
      const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
      if (rgbMatch) {
        r = parseInt(rgbMatch[1], 10);
        g = parseInt(rgbMatch[2], 10);
        b = parseInt(rgbMatch[3], 10);
        if (rgbMatch[4] !== undefined) {
          // Convertir l'alpha de 0-1 en 0-255
          a = Math.round(parseFloat(rgbMatch[4]) * 255);
        }
      } else {
        throw new Error('Format rgb(a) invalide');
      }
    } else {
      throw new Error('Format de couleur non pris en charge');
    }
    
    // Vérifier que les valeurs sont dans les intervalles valides
    if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255 || a < 0 || a > 255) {
      throw new Error('Valeurs RGBA hors limites');
    }
    
    // Construire la valeur ARGB numérique
    // (a << 24) | (r << 16) | (g << 8) | b
    return (a << 24) | (r << 16) | (g << 8) | b;
  }