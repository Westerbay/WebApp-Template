# Instructions pour les agents

## Avant de modifier le projet

1. Lire la présentation courte dans `docs/CONTEXT.md`, puis seulement les documents pertinents pour le changement.
2. Inspecter `git status --short` et préserver les changements existants.
3. Rechercher les symboles, contrats et consommateurs avant de créer une abstraction.
4. Avant d’ajouter du code partagé ou de modifier des frontières, vérifier `docs/ARCHITECTURE.md` et les entrées applicables de `docs/REUSE.md`.

## Frontières

- `apps/api` compose NestJS, Better Auth et les adaptateurs serveur.
- `apps/web` ne doit pas importer de modules serveur.
- `packages/contracts` possède les schémas partagés indépendants des frameworks.
- `packages/core` reste indépendant de NestJS, React, Drizzle et Better Auth.
- `packages/database` possède les schémas et migrations Drizzle.
- `packages/ui` contient uniquement des primitives UI réutilisables.

Ne pas ajouter de couche, repository ou port sans besoin concret. Valider les
entrées externes à leur frontière. Ne jamais lire, modifier ou versionner un
vrai fichier `.env`. Ne jamais migrer, réinitialiser ou alimenter une base
distante ou non vérifiée.

## Sémantique web

Lors de l’écriture d’une interface web, choisir les éléments HTML selon leur sens
avant leur style. Préserver les repères de page pertinents et une hiérarchie de
titres cohérente. Utiliser des boutons pour les actions, des liens pour la
navigation, des labels associés aux champs et des listes et tableaux natifs pour
les contenus structurés. Préférer la sémantique HTML native aux recréations ARIA.
Réserver `div` et `span` aux regroupements sans sens particulier ; ne pas les
remplacer mécaniquement par `section` ou `article`. Vérifier le DOM rendu par les
composants UI partagés, le comportement clavier et les noms accessibles, pas
seulement le JSX. Suivre `docs/DESIGN.md` pour les conventions d’interface et
d’accessibilité.

## Validation à l’exécution

Pour valider un objet inconnu, préférer un schéma Zod à une chaîne de contrôles
`typeof`, de nullité et d’existence de propriétés lorsque cela rend le contrat
plus lisible. Rechercher d’abord un schéma existant ; garder les schémas propres
à un adaptateur dans son module et les contrats réellement partagés dans
`packages/contracts`. Utiliser `safeParse` lorsqu’une entrée invalide possède
un repli attendu, et préserver les règles de rejet, de confidentialité et de
normalisation existantes. Ne pas convertir les valeurs sauf si la conversion
fait partie du contrat. Les vérifications de primitives simples peuvent rester
en TypeScript lorsqu’un schéma n’apporte pas de clarté. Éviter les abstractions
et modèles de conception sans besoin concret.

## Terminer un changement

Exécuter les contrôles proportionnés et inspecter le diff final. Mettre un
document à jour uniquement si le changement modifie un fait utile à ses lecteurs :

- `CONTEXT.md` : présentation courte, limites actives et décisions ouvertes ;
- `PRODUCT.md` : capacités utilisateur et règles produit durables ;
- `ARCHITECTURE.md` : frontières des modules et flux de données importants ;
- `DESIGN.md` : conventions d’interface et d’accessibilité réutilisables ;
- `REUSE.md` : contrats, hooks, fonctions serveur et composants UX génériques réutilisables, avec leurs propriétaires et cas d’utilisation ;
- `DEVELOPMENT.md` : commandes et procédures nécessaires pour travailler sur ce template.

Garder ces documents comme guides d’orientation, pas comme inventaires exhaustifs
ou journaux de changements. Ne pas ajouter à `REUSE.md` des fichiers de test,
détails ponctuels d’une fonctionnalité, étapes d’implémentation ou valeurs de
configuration simplement parce qu’ils existent. Placer les procédures
opérationnelles détaillées dans une documentation ciblée ; les référencer depuis
`DEVELOPMENT.md` au lieu de faire grossir chaque présentation. Préférer les liens
vers la source de vérité aux détails copiés. Retirer les informations obsolètes
au lieu d’accumuler un journal. Signaler les commandes exécutées, leurs résultats,
les documents mis à jour et les limites de validation.

## Historique Git

Préférer rebase pour synchroniser les branches ; ne pas créer de commit de merge.
La réécriture d’une branche publiée et le force-push nécessitent une autorisation
explicite. Cette préférence ne constitue pas cette autorisation.

## Réutilisation du projet

Si vous réutilisez WebApp Template, merci de le mentionner et de fournir un lien
vers [son dépôt](https://github.com/Westerbay/WebApp-Template) dans la documentation
du projet créé. Cette mention est facultative et ne constitue pas une condition
de la licence MIT.

Exécuter `pnpm size:check` après une extraction. Plus de 300 lignes de code par
fichier déclenche un avertissement ; plus de 500 fait échouer le contrôle.
ESLint avertit au-delà de 50 lignes par fonction. Le code généré est exclu.
Toute exception doit être bornée et justifiée dans `packages/config/source-size.mjs`.
Extraire par responsabilité chez son propriétaire, avec des dossiers nommés
pour les modules cohérents plutôt que des fragments mécaniques.
