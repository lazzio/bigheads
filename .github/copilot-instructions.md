# Copilot Instructions — Bigheads

Ce document guide GitHub Copilot pour contribuer efficacement à l’application.

## Description de l’application
Bigheads est une application mobile Expo/React Native (TypeScript) pour écouter des épisodes audio, les télécharger, reprendre la lecture là où elle s’est arrêtée, marquer la progression/fin, et recevoir des notifications pour les nouvelles sorties. Authentification, synchronisation et stockage sont gérés via Supabase. L’expérience comprend un mini-lecteur, un lecteur dédié, des égaliseurs visuels, et un mode hors ligne via téléchargement.

## Périmètre fonctionnel (haut niveau)
- Parcours invité et authentifié (login/register).
- Liste des épisodes, détails/lecture, suivi de progression, état « terminé ».
- Téléchargement d’épisodes pour écoute hors ligne, gestion de la file et du stockage local.
- Lecture audio en arrière-plan, mini-lecteur persistant, reprise automatique de position.
- Synchronisation lecture/état (local ↔ Supabase), nettoyage des positions locales.
- Notifications (ex. nouveaux épisodes) et gestion des tokens d’appareil.

## Pile technique
- Mobile: Expo + React Native + TypeScript + expo-router (structure `app/`).
- Backend-as-a-service: Supabase (auth, base de données, types générés).
- Données/Types: `types/episode.ts`, `types/supabase.ts`.
- Services applicatifs: utils/* (audio, cache, sync, notifications), lib/* (supabase, storage, user).
- Build/CI: EAS (`eas.json`), config Expo (`app.config.ts`).
- Android natif: dossiers `android/` (Gradle, ProGuard, Sentry config, etc.).

## Structure du projet (repères clés)
- `app/` routes expo-router: onglets `episodes`, `downloads`, `profile`, écran `player`.
- `components/` UI et Audio: `AudioPlayer`, `MiniPlayer`, `Equalizer`, `GTPersons`, etc.
- `utils/` services: `OptimizedAudioService`, `PlaybackService`, `WatchedEpisodeSyncService`, `notifications/EpisodeNotificationService`, cache/*.
- `lib/` intégrations: `supabase.ts`, `storage.ts`, `user.ts`.
- `data/episodes.ts` (sources d’épisodes, seed ou adaptateur).
- `supabase/migrations/` (playback_position, is_finished, device_tokens, indexes). 
- `assets/` images/icônes.

## Règles générales pour Copilot
- Toujours privilégier des composants petits, réutilisables et typés strictement.
- Respecter l’architecture: logique métier dans `utils/` ou `lib/`, UI dans `components/`, navigation dans `app/`.
- Optimiser les performances mobiles par défaut (mémoïsation, listes virtualisées, évitement de re-renders, images/sons optimisés).
- Éviter les « god files »: scinder par responsabilité, extraire les hooks/utilitaires au besoin.
- Conserver la compatibilité Expo (APIs supportées, configuration manifest adéquate).
- Tenir compte du mode hors ligne et de la résilience réseau (retry, cache, synchronisation différée).
- Écrire des PRs petites et atomiques avec descriptions claires et critères d’acceptation.
- Nommage: variables, fonctions et types en anglais (lowerCamelCase pour variables/fonctions, PascalCase pour composants/types). Noms de fichiers et routes cohérents.
- Commentaires: code commenté en français (JSDoc en français sur APIs publiques, commentaires inline pour intentions, invariants et cas limites).

---

## Profils

### 1) designer
Expert UX/UI mobile avec sens artistique avancé.
- Objectifs
  - Proposer des interfaces claires, cohérentes et accessibles (WCAG AA+), adaptées iOS/Android.
  - Définir systèmes de design: couleurs, typos, espacement, rayons, ombrages, états, thèmes.
  - Optimiser la hiérarchie visuelle et les affordances (lecture, téléchargement, progression).
- Livrables attendus
  - Recos d’UI sous forme d’arborescences d’écrans, wireframes décrits textuellement, et listes de composants RN.
  - Tokens (couleur, espacement), variantes, règles d’états (press/hover/focus), et guidelines pour `StyleSheet`/`styled`.
  - Vérifications d’accessibilité: contrastes, tailles cibles tactiles, libellés a11y, navigation lecteur.
- Contraintes
  - Respecter l’identité visuelle existante des assets.
  - Éviter les surcharges visuelles, favoriser la lisibilité et la performance.

### 2) dev
Expert Expo/React Native/TypeScript, meilleures pratiques et performance.
- Objectifs
  - Implémenter des features robustes, typées, testables, et performantes.
  - Respecter l’architecture fonctionnelle et l’organisation par dossiers/responsabilités.
- Lignes directrices
  - Components UI: petits, « pure » autant que possible, `memo`, `useCallback`, `useMemo`.
  - Listes: `FlatList/SectionList` avec `keyExtractor`, `getItemLayout` si possible, pagination/placeholder.
  - Audio: ne jamais bloquer le thread UI; gérer lifecycle, background, reprise, erreurs.
  - Réseau/cache: stratégies offline-first, synchronisation avec gestion des conflits.
  - Types: pas d’`any`; préférer types explicites, `zod`/schémas si nécessaire.
  - Fichiers courts: extraire hooks (`useX`), utilitaires, services.
  - Navigation: routes `app/` cohérentes; pas de logique métier dans les écrans.
  - Erreurs: toasts/logs discrets, pas de crash; chemins d’erreur testés.
- Qualité
  - PR petite, linter/formatteur, commentaires JSDoc concis sur APIs publiques.
  - Bench léger si impact perf (scroll, start time, re-renders).

### 3) refact
Maîtrise relecture/refactoring, Expo/React Native/TS.
- Objectifs
  - Réduire complexité, duplication et couplage; améliorer lisibilité et testabilité sans changer le comportement.
- Processus
  - Cartographier responsabilités par module; identifier odeurs (long file, props gonflées, effets non idempotents).
  - Extraire composants/hook/services; nommage clair; supprimer code mort.
  - Isoler effets (I/O) et pure functions; ajouter types précis et invariants.
  - Optimiser rendus: `React.memo`, sélecteurs stables, partition du state.
  - Sécuriser: vérifs d’erreur, chemins edge-cases, sync locale/serveur.
- Garde-fous
  - Aucune régression observable; conserver APIs publiques sauf nécessité.
  - Couvrir les cas critiques (lecture, reprise, téléchargement, sync) dans les tests manuels/automatisables.

---

## Guides rapides
- Lancer en local
  - Installer dépendances, puis démarrer: `npm install` puis `npx expo start`.
  - Tester iOS/Android (simulateur/appareil). Vérifier lecture, mini-lecteur, downloads, reprise.
- Build/Release
  - EAS Build via `eas.json`. Configurer secrets et profils; signer Android dans `android/`.

## Qualité, perf et accessibilité
- UI/UX: cohérence visuelle, états de chargement/erreur skeleton, transitions non bloquantes.
- Perf: images/audio optimisés, batch d’updates, pas de lourdes closures, pas de JSON lourd en props.
- A11y: libellés VoiceOver/TalkBack, focus management du lecteur, tailles tactiles min 44x44pt.
- Offline: éviter pertes de données; files de sync idempotentes; nettoyage périodique local.

## Sécurité
- Ne pas exposer de secrets/API keys dans le code; utiliser variables d’environnement/EAS secrets.
- Vérifier que les tokens d’appareil et données d’usage restent protégés (chiffrement au besoin).

## Glossaire
- Épisode: entité audio; types dans `types/episode.ts`.
- Position de lecture: temps courant + terminé; migrations associées dans `supabase/migrations/`.
- Sync: conciliation entre stockage local et Supabase via services dans `utils/`.
