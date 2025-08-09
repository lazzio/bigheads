#!/usr/bin/env python3
"""
Script simple pour récupérer le lien RSS depuis pod.link

Exemple d'utilisation:
    from podlink_simple import get_rss_from_podlink
    
    rss_url = get_rss_from_podlink("https://pod.link/369369012.rss")
    print(rss_url)
"""

import requests
import re
from typing import Optional

def get_rss_from_podlink(podlink_url: str) -> Optional[str]:
    """
    Récupère l'URL du flux RSS depuis une page pod.link
    
    Args:
        podlink_url (str): URL de la page pod.link (ex: https://pod.link/369369012.rss)
        
    Returns:
        Optional[str]: URL du flux RSS ou None si non trouvé
        
    Example:
        >>> rss_url = get_rss_from_podlink("https://pod.link/369369012.rss")
        >>> print(rss_url)
        https://feeds.audiomeans.fr/feed/d7c6111b-04c1-46bc-b74c-d941a90d37fb.xml
    """
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
    
    try:
        # Récupérer la page pod.link
        response = requests.get(podlink_url, headers=headers, timeout=10)
        response.raise_for_status()
        
        # Chercher les URLs RSS dans le code source
        rss_patterns = [
            r'https://feeds\.audiomeans\.fr/feed/[a-f0-9-]+\.xml',
            r'https://feeds\.megaphone\.fm/[^"\'\s<>]+',
            r'https://podcast\.ausha\.co/rss/[^"\'\s<>]+',
            r'https?://[^"\'\s<>]*(?:rss|feed)[^"\'\s<>]*\.xml',
        ]
        
        for pattern in rss_patterns:
            matches = re.findall(pattern, response.text, re.IGNORECASE)
            for match in matches:
                # Nettoyer l'URL et tester si elle fonctionne
                clean_url = re.sub(r'[,;)\]}"\'\\]+$', '', match)
                if _test_rss_url(clean_url):
                    return clean_url
        
        return None
        
    except Exception as e:
        print(f"Erreur: {e}")
        return None

def _test_rss_url(url: str) -> bool:
    """Teste si une URL RSS est valide"""
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.head(url, headers=headers, timeout=5, allow_redirects=True)
        return response.status_code == 200
    except:
        return False

if __name__ == "__main__":
    test_url = "https://pod.link/369369012.rss"
    rss_url = get_rss_from_podlink(test_url)
    
    if rss_url:
        print(f"✅ Flux RSS trouvé: {rss_url}")
    else:
        print("❌ Aucun flux RSS trouvé")
