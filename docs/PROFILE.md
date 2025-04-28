# Tab Profil – Documentation Fonctionnelle et Technique

## 1. Présentation

La tab **Profil** permet à l'utilisateur de gérer les paramètres de son compte, de consulter ses informations de profil, et de se déconnecter de l'application. Elle centralise les actions liées à l'identité et à la session utilisateur.

---

## 2. Fonctionnalités Utilisateur

- **Affichage des informations du compte** : nom, email, etc. (selon les données disponibles).
- **Déconnexion sécurisée** : bouton pour se déconnecter, avec confirmation via une modale.
- **Feedback utilisateur** : indicateur de chargement lors de la déconnexion, gestion des erreurs.
- **Accessibilité** : interface claire, boutons explicites, feedback visuel.

---

## 3. Architecture Technique

### 3.1. Structure des composants

- **app/(tabs)/profile.tsx**
  - Point d'entrée de la tab.
  - Affiche les informations du profil utilisateur.
  - Gère la logique de déconnexion.
  - Affiche une modale de confirmation avant la déconnexion.
  - Utilise les styles globaux et des styles spécifiques pour la présentation.

### 3.2. Gestion des données

- **Récupération des informations utilisateur**
  - Les informations affichées proviennent de la session Supabase ou du contexte utilisateur (à compléter selon l'évolution).
  - Possibilité d'étendre pour afficher plus d'informations (avatar, nombre d'épisodes écoutés, etc.).

- **Déconnexion**
  - Utilise la méthode `supabase.auth.signOut()` pour fermer la session côté serveur.
  - Nettoie les données sensibles du stockage local (`storage.removeItem` pour les tokens).
  - Redirige l'utilisateur vers la page de login après déconnexion.
  - Affiche un indicateur de chargement pendant la déconnexion.
  - Affiche une modale de confirmation pour éviter les déconnexions accidentelles.

- **Gestion des erreurs**
  - Si une erreur survient lors de la déconnexion, elle est loggée et l'utilisateur reste connecté.

---

## 4. Flux de données et interactions

1. **Affichage du profil**
   - Les informations du compte sont affichées dès l'ouverture de la tab.

2. **Déconnexion**
   - L'utilisateur clique sur "Se déconnecter".
   - Une modale de confirmation s'affiche.
   - Si l'utilisateur confirme, la déconnexion est lancée :
     - Appel à `supabase.auth.signOut()`.
     - Nettoyage du stockage local.
     - Redirection vers la page de login.
   - Si l'utilisateur annule, la modale se ferme.

3. **Gestion des états**
   - Un indicateur de chargement s'affiche pendant la déconnexion.
   - Les boutons sont désactivés pendant les opérations critiques.

---

## 5. Modèles de données

### 5.1. Utilisateur (exemple simplifié)

```ts
interface UserProfile {
  id: string;
  email: string;
  // Ajoutez d'autres champs selon les besoins (nom, avatar, etc.)
}
```

---

## 6. Points techniques importants

- **Sécurité** : nettoyage explicite des tokens et données sensibles lors de la déconnexion.
- **UX** : confirmation avant déconnexion, feedback visuel, gestion des erreurs.
- **Extensibilité** : possibilité d'ajouter des paramètres, préférences, ou informations supplémentaires.

---

## 7. Bonnes pratiques et UX

- **Confirmation avant action critique** : modale pour éviter les déconnexions accidentelles.
- **Indicateur de chargement** : retour visuel lors des opérations longues.
- **Accessibilité** : boutons larges, textes explicites, couleurs contrastées.
- **Séparation claire des responsabilités** : logique métier et présentation bien distinctes.

---

## 8. Dépendances principales

- **React Native** : gestion de l'UI, modales, styles.
- **Supabase** : gestion de l'authentification et de la session.
- **Expo Router** : navigation après déconnexion.
- **AsyncStorage / Custom Storage** : nettoyage des données locales.

---

## 9. Évolutions possibles

- Ajout de la gestion/modification du profil (nom, avatar, etc.).
- Affichage de statistiques utilisateur (nombre d'épisodes écoutés, temps d'écoute, etc.).
- Gestion des préférences (thème, notifications, etc.).
- Suppression du compte.
- Intégration d'un support/contact.

---

## 10. Références de code

- `app/(tabs)/profile.tsx`
- `lib/supabase.ts`
- `lib/storage.ts`
- `styles/componentStyle.ts`
- `styles/global.ts`

---
