# Tab Épisodes – Documentation Fonctionnelle et Technique

## 1. Présentation

La tab **Épisodes** permet à l'utilisateur de parcourir la liste complète des épisodes disponibles, de voir leur statut d'écoute, d'accéder à leur description, et de lancer la lecture d'un épisode. Elle gère la récupération des données en ligne et hors-ligne, l'affichage des erreurs, le rafraîchissement manuel, et l'intégration avec le lecteur audio.

---

## 2. Fonctionnalités Utilisateur

- **Affichage de la liste des épisodes** : titre, description, date, durée.
- **Statut d'écoute** : indication visuelle si l'épisode a été écouté (check ou icône play).
- **Lecture d'un épisode** : clic sur un épisode → ouverture du player sur l'épisode choisi.
- **Rafraîchissement par "pull-to-refresh"** : tirer la liste vers le bas recharge les épisodes.
- **Gestion du mode hors-ligne** : affichage d'un bandeau et chargement depuis le cache si pas de connexion.
- **Gestion des erreurs** : affichage d'un message d'erreur et bouton "Réessayer" si besoin.
- **Affichage d'un état vide** : message adapté si aucun épisode n'est disponible.

---

## 3. Architecture Technique

### 3.1. Structure des composants

- **app/(tabs)/episodes.tsx**
  - Point d'entrée de la tab.
  - Utilise le hook `useEpisodes` pour charger les données.
  - Passe les données et callbacks à `EpisodeListHeader` et `EpisodeList`.

- **components/episodes/EpisodeListHeader.tsx**
  - Affiche le titre "Épisodes" et peut accueillir des actions futures (recherche, filtre).

- **components/episodes/EpisodeList.tsx**
  - Affiche la liste des épisodes via un `FlatList`.
  - Gère l'affichage du bandeau hors-ligne, des erreurs, de l'état vide.
  - Intègre le `RefreshControl` pour le "pull-to-refresh".

- **components/episodes/EpisodeListItem.tsx**
  - Affiche un épisode individuel (titre, description, date, durée, statut d'écoute).
  - Appelle `onPress` pour lancer la lecture.

- **components/episodes/OfflineBanner.tsx**
  - Affiche un bandeau "Mode hors-ligne" si besoin.

- **components/episodes/EmptyState.tsx** et **ErrorState.tsx**
  - Affichent respectivement l'état vide et l'état d'erreur.

### 3.2. Gestion des données

- **Chargement des épisodes**
  - Utilise le hook `useEpisodes` qui s'appuie sur `getEpisodes` (service).
  - Si en ligne : fetch depuis Supabase, puis mise à jour du cache local.
  - Si hors-ligne ou erreur : chargement depuis le cache local (`AsyncStorage`).

- **Statut d'écoute**
  - Récupéré via `fetchWatchedEpisodeIds` (service).
  - Affiche une coche si l'épisode est marqué comme "fini" (`is_finished: true` dans la table `watched_episodes`).

- **Rafraîchissement**
  - Le "pull-to-refresh" déclenche le rechargement des épisodes et du statut d'écoute.

- **Gestion du mode hors-ligne**
  - Détection automatique via `NetInfo`.
  - Affichage d'un bandeau et chargement depuis le cache si besoin.

- **Gestion des erreurs**
  - Toute erreur de chargement affiche un message et propose de réessayer.

### 3.3. Navigation

- **Lecture d'un épisode**
  - Clic sur un épisode → navigation vers `/player` avec le paramètre `episodeId`.
  - Le player se charge alors sur l'épisode demandé.

---

## 4. Flux de données

1. **Montage de la tab**
   - `useEpisodes` charge les épisodes (en ligne ou cache).
   - Récupère le statut d'écoute.
   - Met à jour les états `episodes`, `watchedEpisodes`, `loading`, `error`, `isOffline`.

2. **Affichage**
   - Si `loading` : spinner.
   - Si `error` et pas d'épisodes : message d'erreur + bouton "Réessayer".
   - Si pas d'épisodes : message d'état vide.
   - Sinon : liste des épisodes.

3. **Interaction**
   - "Pull-to-refresh" → recharge les données.
   - Clic sur un épisode → navigation vers le player.

---

## 5. Modèles de données

### 5.1. Épisode (`Episode`)

```ts
interface Episode {
  id: string;
  title: string;
  description: string;
  originalMp3Link?: string;
  mp3Link: string;
  duration: string | number;
  publicationDate: string;
  offline_path?: string;
  artworkUrl?: string;
}
```

### 5.2. Statut d'écoute

- Récupéré via la table `watched_episodes` (champ `is_finished`).

---

## 6. Points techniques importants

- **Cache local** : tous les épisodes sont mis en cache pour le mode hors-ligne.
- **Synchronisation** : la synchronisation des statuts d'écoute et des positions se fait en tâche de fond (voir `PlaybackSyncService`).
- **Extensibilité** : la structure permet d'ajouter facilement des filtres, une recherche, ou d'autres actions sur la liste.

---

## 7. Bonnes pratiques et UX

- **Pull-to-refresh** : standard mobile, pas de bouton "Refresh" manuel.
- **Affichage réactif** : gestion fine des états (chargement, erreur, vide, hors-ligne).
- **Navigation fluide** : passage immédiat au player sur l'épisode choisi.
- **Accessibilité** : icônes et textes explicites, feedback utilisateur sur chaque action.

---

## 8. Dépendances principales

- **React Native** : FlatList, RefreshControl, AsyncStorage.
- **Supabase** : récupération des épisodes et statuts d'écoute.
- **NetInfo** : détection du mode hors-ligne.
- **Expo Router** : navigation entre les tabs et vers le player.

---

## 9. Évolutions possibles

- Ajout d'une recherche ou de filtres.
- Affichage des épisodes téléchargés uniquement.
- Marquage manuel d'un épisode comme "écouté".
- Affichage d'une image ou jaquette si disponible.

---

## 10. Références de code

- `app/(tabs)/episodes.tsx`
- `components/episodes/EpisodeList.tsx`
- `components/episodes/EpisodeListItem.tsx`
- `hooks/episodes/useEpisodes.ts`
- `services/episodes/episodeService.ts`
- `services/episodes/watchedEpisodeService.ts`
- `components/episodes/OfflineBanner.tsx`
- `components/episodes/EmptyState.tsx`
- `components/episodes/ErrorState.tsx`

---