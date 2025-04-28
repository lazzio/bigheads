# Tab Téléchargements – Documentation Fonctionnelle et Technique

## 1. Présentation

La tab **Téléchargements** permet à l'utilisateur de gérer ses épisodes téléchargés pour une écoute hors-ligne. Elle offre la possibilité de télécharger, supprimer, et lire des épisodes localement, tout en affichant l'état de chaque téléchargement et en gérant le mode hors-ligne de façon transparente.

---

## 2. Fonctionnalités Utilisateur

- **Affichage de la liste des épisodes** disponibles (en cache ou téléchargés).
- **Téléchargement d'un épisode** pour une écoute hors-ligne.
- **Indicateur de progression** lors du téléchargement (cercle de progression en %).
- **Suppression d'un épisode téléchargé** individuellement ou suppression globale de tous les téléchargements.
- **Lecture d'un épisode téléchargé** directement depuis le stockage local.
- **Affichage du statut** : téléchargé, en cours de téléchargement, non téléchargé.
- **Mode hors-ligne** : accès aux épisodes téléchargés même sans connexion.
- **Rafraîchissement de la liste** par "pull-to-refresh" (tirer la liste vers le bas).
- **Affichage des erreurs** et gestion des cas d'absence d'épisodes.

---

## 3. Architecture Technique

### 3.1. Structure des composants

- **app/(tabs)/downloads.tsx**
  - Point d'entrée de la tab.
  - Gère tout le cycle de vie, la logique métier et l'affichage.
  - Utilise un `FlatList` pour l'affichage performant de la liste.
  - Utilise `RefreshControl` pour le "pull-to-refresh".

### 3.2. Gestion des données

- **Chargement des épisodes**
  - Tente de charger les épisodes depuis le cache local (`AsyncStorage`).
  - Si en ligne, met à jour la liste depuis Supabase et rafraîchit le cache.
  - Si hors-ligne, affiche uniquement les épisodes téléchargés.

- **Téléchargement**
  - Utilise `expo-file-system` pour télécharger les fichiers MP3 dans un dossier local.
  - Stocke des métadonnées `.meta` pour chaque fichier téléchargé (id, titre, description, date de téléchargement).
  - Affiche la progression du téléchargement en temps réel.

- **Suppression**
  - Permet la suppression individuelle ou globale des fichiers téléchargés (et de leurs métadonnées).
  - Met à jour l'état local et la liste des épisodes après suppression.

- **Gestion du statut**
  - Pour chaque épisode, indique s'il est téléchargé, en cours de téléchargement, ou non téléchargé.
  - Affiche un bouton d'action adapté (télécharger, supprimer, etc.).

- **Mode hors-ligne**
  - Détecte l'absence de connexion via `NetInfo`.
  - Affiche uniquement les épisodes téléchargés si hors-ligne.

- **Rafraîchissement**
  - Le "pull-to-refresh" recharge la liste des épisodes et leur statut de téléchargement.

- **Nettoyage automatique**
  - Un intervalle supprime automatiquement les téléchargements vieux de plus de 7 jours.

---

## 4. Flux de données

1. **Montage de la tab**
   - Vérifie la connexion réseau.
   - Charge les épisodes depuis le cache ou l'API.
   - Met à jour la liste des épisodes et leur statut de téléchargement.

2. **Téléchargement**
   - L'utilisateur clique sur le bouton de téléchargement.
   - Le fichier est téléchargé, la progression est affichée.
   - À la fin, le statut passe à "téléchargé".

3. **Suppression**
   - L'utilisateur clique sur la corbeille (individuelle ou globale).
   - Le fichier et ses métadonnées sont supprimés.
   - La liste est mise à jour.

4. **Lecture**
   - L'utilisateur clique sur un épisode téléchargé.
   - Navigation vers le player avec le chemin local du fichier.

5. **Rafraîchissement**
   - L'utilisateur tire la liste vers le bas.
   - Rafraîchit la liste des épisodes et leur statut.

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
  offline_path?: string; // Chemin local si téléchargé
  // ...
}
```

### 5.2. Métadonnées de téléchargement

```ts
{
  id: string;
  title: string;
  description: string;
  downloadDate: string; // ISO
  // ...
}
```

---

## 6. Points techniques importants

- **Stockage local** : fichiers MP3 et métadonnées stockés dans le dossier `downloads/` via `expo-file-system`.
- **Cache** : la liste des épisodes est également stockée dans `AsyncStorage` pour un accès rapide hors-ligne.
- **Gestion de la progression** : affichage d'un cercle de progression pendant le téléchargement.
- **Suppression automatique** : les téléchargements de plus de 7 jours sont supprimés automatiquement.
- **Robustesse** : gestion des erreurs réseau, de stockage, et feedback utilisateur.

---

## 7. Bonnes pratiques et UX

- **Pull-to-refresh** : standard mobile, pas de bouton "Refresh" manuel.
- **Affichage clair du statut** : téléchargé, en cours, non téléchargé.
- **Actions rapides** : suppression individuelle ou globale.
- **Feedback utilisateur** : progression, erreurs, confirmation de suppression.
- **Mode hors-ligne** : expérience fluide même sans connexion.

---

## 8. Dépendances principales

- **React Native** : FlatList, RefreshControl, AsyncStorage.
- **Expo FileSystem** : gestion des fichiers locaux.
- **Supabase** : récupération des épisodes.
- **NetInfo** : détection du mode hors-ligne.
- **Expo Router** : navigation vers le player.

---

## 9. Évolutions possibles

- Sélection multiple pour suppression groupée.
- Téléchargement automatique des nouveaux épisodes.
- Gestion de la taille totale occupée.
- Filtrage/affichage uniquement des épisodes téléchargés dans la tab Épisodes.
- Possibilité de déplacer les fichiers sur la carte SD (Android).

---

## 10. Références de code

- `app/(tabs)/downloads.tsx`
- `types/episode.ts`
- `services/episodes/episodeService.ts`
- `utils/constants.ts`
- `expo-file-system` (documentation)

---
