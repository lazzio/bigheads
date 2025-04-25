# Architecture du Lecteur Audio (Refonte)

Ce document décrit l'architecture refondue et les fonctionnalités du lecteur audio de l'application Big Heads, axée sur la modularité, la séparation des préoccupations et la robustesse.

**Principes Directeurs :**

*   **Simplicité :** Logique claire et facile à suivre.
*   **Robustesse :** Gestion fiable des états (en ligne/hors ligne, erreurs, chargement).
*   **Rapidité :** Interface réactive et chargement optimisé.
*   **Optimisation :** Utilisation efficace des ressources (réseau, batterie).
*   **Modularité :** Composants, hooks et services découplés.

**Structure des Dossiers Clés :**

*   `/app/(tabs)/player.tsx`: Écran principal (conteneur).
*   `/components/player/AudioPlayerUI.tsx`: Composant UI "dumb" pour les contrôles.
*   `/contexts/PlayerContext.tsx`: Contexte React pour l'état global du lecteur.
*   `/hooks/useAudioManager.ts`: Gestion de `react-native-track-player` et des événements audio.
*   `/hooks/useEpisodeData.ts`: Chargement des données (épisodes, positions).
*   `/hooks/usePlayerState.ts`: Accès simplifié au `PlayerContext`.
*   `/services/OfflineService.ts`: Logique spécifique au mode hors ligne (cache, métadonnées, files d'attente).
*   `/services/PlaybackSyncService.ts`: Synchronisation avec Supabase.
*   `/utils/audioUtils.ts`: Fonctions utilitaires (ex: `formatTime`).
*   `/utils/constants.ts`: Constantes partagées (clés AsyncStorage, etc.).
*   `/types/`: Définitions TypeScript (Episode, PlayerState, etc.).

## 1. Gestion de l'État (`PlayerContext`)

*   **État Centralisé :** Un contexte React (`PlayerContext`) contient l'état complet du lecteur :
    *   `currentEpisode`: L'épisode actuellement chargé ou en cours de lecture.
    *   `episodes`: La liste complète des épisodes disponibles.
    *   `currentIndex`: L'index de `currentEpisode` dans `episodes`.
    *   `isPlaying`, `isBuffering`, `isLoading`: Statuts de lecture et de chargement.
    *   `position`, `duration`: Position et durée de l'épisode en cours.
    *   `playbackPositions`: Map des positions sauvegardées (`episodeId` -> `positionSeconds`).
    *   `isOffline`: Statut de la connectivité réseau.
    *   `error`: Message d'erreur éventuel.
*   **Actions :** Des actions définies dans le contexte permettent de modifier l'état de manière contrôlée (ex: `loadEpisode`, `play`, `pause`, `setEpisodes`, `updatePosition`, `setError`).
*   **Accès :** Le hook `usePlayerState` fournit un accès facile à l'état et aux actions du contexte.

## 2. Gestion Audio (`useAudioManager`)

*   **Abstraction de `TrackPlayer` :** Ce hook initialise et interagit avec `react-native-track-player`.
*   **Gestion des Événements :** Écoute les événements de `TrackPlayer` (changement d'état, fin de piste, erreur, contrôles de notification) et met à jour le `PlayerContext` en conséquence.
*   **Contrôles de Lecture :** Expose des fonctions claires pour contrôler la lecture (`playAudio`, `pauseAudio`, `seekTo`, `skipToNext`, `skipToPrevious`, `loadTrack`) qui interagissent avec `TrackPlayer` et le `PlayerContext`.
*   **Notifications :** Configure et gère les contrôles de lecture via la notification système.
*   **Gestion Arrière-Plan :** Assure la configuration pour la lecture en arrière-plan.

## 3. Chargement des Données (`useEpisodeData`)

*   **Récupération des Épisodes :**
    *   Vérifie l'état du réseau (`NetInfo`).
    *   Si en ligne : Tente de récupérer les épisodes depuis Supabase. Met à jour le cache local (`AsyncStorage`).
    *   Si hors ligne (ou échec en ligne) : Tente de charger les épisodes depuis le cache via `OfflineService`.
    *   Met à jour l'état `episodes` et `isOffline` dans le `PlayerContext`.
*   **Récupération des Positions :**
    *   Si en ligne : Récupère les positions de lecture depuis Supabase (`watched_episodes`).
    *   Met à jour l'état `playbackPositions` dans le `PlayerContext`.
*   **Gestion des Erreurs :** Gère les erreurs de fetch et met à jour l'état `error` dans le `PlayerContext`.

## 4. Logique Hors Ligne (`OfflineService`)

*   **Cache Épisodes :** Fournit des fonctions pour lire (`loadCachedEpisodes`) et écrire (`saveEpisodesToCache`) la liste des épisodes dans `AsyncStorage`.
*   **Métadonnées Locales :** Fonction (`getOfflineEpisodeDetails`) pour lire le fichier `.meta` associé à un `offlinePath` et retourner les détails de l'épisode.
*   **File d'attente "Écouté" :** Gère une liste d'IDs d'épisodes marqués comme terminés hors ligne (`addOfflineWatched`, `getOfflineWatched`, `clearOfflineWatched`) dans `AsyncStorage`.
*   **File d'attente Positions :** Gère la sauvegarde des positions de lecture non synchronisées (`savePendingPosition`, `getPendingPositions`, `clearPendingPositions`) dans `AsyncStorage`.

## 5. Synchronisation (`PlaybackSyncService`)

*   **Déclenchement :** Activé au démarrage, au retour au premier plan, ou au rétablissement de la connexion.
*   **Synchronisation Positions :** Lit les positions en attente via `OfflineService`, les envoie à Supabase (`watched_episodes`, `is_finished: false`), et les supprime localement en cas de succès.
*   **Synchronisation "Écouté" :** Lit les IDs d'épisodes terminés hors ligne via `OfflineService`, met à jour Supabase (`watched_episodes`, `is_finished: true`, `playback_position: null`), et les supprime localement en cas de succès.

## 6. Interface Utilisateur (`PlayerScreen`, `AudioPlayerUI`)

*   **`PlayerScreen` (Conteneur) :**
    *   Utilise `usePlayerState` pour accéder à l'état global.
    *   Utilise `useEpisodeData` pour déclencher le chargement initial des données.
    *   Utilise `useAudioManager` pour obtenir les fonctions de contrôle.
    *   Gère la logique de sélection initiale de l'épisode (basée sur `episodeId`, `offlinePath`, ou le premier de la liste).
    *   Gère l'affichage des états globaux (chargement, erreur, mode hors ligne).
    *   Passe l'état pertinent et les callbacks d'action au composant `AudioPlayerUI`.
    *   Gère la navigation et le cycle de vie de l'écran (ex: sauvegarde de la position en quittant via `useAudioManager` ou une action du contexte).
*   **`AudioPlayerUI` (Présentation) :**
    *   Reçoit l'état (`currentEpisode`, `isPlaying`, `position`, `duration`, etc.) et les fonctions de rappel (`onPlayPause`, `onSeek`, `onNext`, `onPrevious`, `onSkipForward`, `onSkipBackward`, `onToggleSleepTimer`) via ses props.
    *   Affiche les informations de l'épisode, la barre de progression, les temps, et les boutons de contrôle.
    *   Ne contient aucune logique métier complexe, se contentant d'afficher les données et d'appeler les fonctions fournies en réponse aux interactions utilisateur.

## 7. Fonctionnalités Spécifiques

*   **Lecture/Pause/Suivant/Précédent/Seek/Skip :** Géré par `useAudioManager` et déclenché via `AudioPlayerUI`.
*   **Chargement Initial :** Orchestré par `PlayerScreen` en utilisant les données de `useEpisodeData` et les actions de `useAudioManager` / `PlayerContext`.
*   **Sauvegarde Position :**
    *   Périodiquement et lors des pauses/changements d'état via `useAudioManager` -> `PlayerContext` -> `OfflineService` (pour la file d'attente).
    *   Synchronisation via `PlaybackSyncService`.
*   **Statut "Écouté" :**
    *   Déclenché par l'événement de fin de piste (`useAudioManager`) ou manuellement.
    *   Met à jour l'état dans `PlayerContext`.
    *   Si hors ligne, ajoute à la file d'attente via `OfflineService`.
    *   Synchronisation via `PlaybackSyncService`.
*   **Gestion Erreurs :** Les erreurs (réseau, lecture, chargement) sont capturées par les hooks/services, stockées dans `PlayerContext`, et affichées par `PlayerScreen`. Un bouton "Réessayer" déclenche à nouveau le chargement via `useEpisodeData`.
*   **Mode Hors Ligne :** Détecté par `useEpisodeData`, état stocké dans `PlayerContext`, bandeau affiché par `PlayerScreen`. La logique de chargement/sauvegarde s'adapte via `OfflineService`.
*   **Minuteur de Sommeil :** Logique gérée au sein de `AudioPlayerUI` ou `PlayerScreen`, utilisant `setTimeout`. L'arrêt de la lecture se fait via `useAudioManager`. La fermeture de l'app reste une fonctionnalité annexe.
*   **Optimisation Batterie / Bouton Retour :** Géré au niveau de `PlayerScreen` ou de la configuration globale de l'application.

Cette nouvelle architecture vise à rendre le code du lecteur plus maintenable, testable et évolutif.
