# Intégration continue

[CI](../.github/workflows/ci.yml) est l’unique point d’entrée pour les PR, main,
les lancements manuels et planifiés. Les autres workflows de validation sont
réutilisables et ne s’abonnent pas aux mêmes événements du dépôt.

| Événement                    | Travail exécuté                                                              |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Pull request                 | Validation complète de l’application/des templates et sécurité               |
| Push direct sur main         | Validation complète et sécurité                                              |
| Fusion d’une PR déjà validée | Réutilisation du résultat uniquement si l’arbre Git enregistré est identique |
| Planification hebdomadaire   | Actualisation de la sécurité uniquement                                      |
| Lancement manuel             | Validation complète et sécurité                                              |

Une validation complète de PR réussie conserve un petit artefact `ci-validated-tree`
pendant 30 jours. Le planificateur de main vérifie dépôt, PR, head et arbre avant
d’omettre le travail. Une preuve absente, expirée ou non fiable, une erreur d’API
ou un arbre différent déclenche la validation complète. Les fusions de forks sont
revérifiées sur main. Un court job de planification s’exécute encore sur main pour
prendre cette décision ; les builds et scans ne sont pas répétés pour une fusion
prouvée. Un nouveau commit annule l’exécution devenue obsolète de sa PR. Le scan
planifié de sécurité n’annule pas une validation applicative.

[Security](../.github/workflows/security.yml) analyse tout l’historique Git avec
Gitleaks, audite les dépendances JavaScript avec pnpm, contrôle un Cargo.lock
présent avec Trivy et scanne une matrice d’images d’infrastructure uniques. Les
résultats HIGH et CRITICAL bloquent même sans correctif disponible. Une erreur
de registre ou de service d’avis de sécurité bloque aussi. Les faux positifs
examinés sont distincts des vraies vulnérabilités ; une image amont vulnérable
maintient le contrôle en échec jusqu’à correction. Ces scans ne chargent aucun
vrai fichier d’environnement et ne démarrent aucune base de données.

La validation applicative est partagée via
[Application checks](../.github/workflows/ci-application.yml) et des actions
composites locales. Elle couvre qualité, tests unitaires, contrats, intégration
et parcours navigateur. Rust vérifie aussi les migrations et le redémarrage,
construit son image de production et analyse cette image. Les tests navigateur
exercent les langues configurées. Les étapes distinctes identifient la phase
en échec et les diagnostics sont conservés.

`Security checks` agrège les contrôles de sécurité. `CI checks` est le statut global
stable à rendre obligatoire dans les règles de branche. Les deux rejettent les
prérequis échoués, annulés ou omis de façon inattendue. Rendre ces statuts obligatoires
est une opération d’administration du dépôt ; les fichiers de workflow seuls
n’imposent pas de protection contre la fusion.
