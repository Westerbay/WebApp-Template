# Produit

Inscription avec nom/email/mot de passe, vérification, connexion, déconnexion,
renvoi du lien et réinitialisation. Le tableau privé affiche les utilisateurs avec
recherche et pagination par curseur. Tout compte vérifié peut lire les emails de
la liste d'exemple ; aucun rôle administrateur n'est prévu.

- Vérification obligatoire avant connexion/accès privé ; aucune connexion automatique.
- Mots de passe de 8–128 caractères exacts. HIBP actif en staging/production ; un refus
  ou une panne consomme le lien de reset sans changer le mot de passe.
- Vérification valable 24 h, reset 1 h et à usage unique ; reset révoque les sessions.
  Sessions de sept jours renouvelables après un jour.
- Les demandes d'email ne révèlent pas l'existence d'un compte.
- Quotas par socket/route partagés en PostgreSQL : auth sensible 5/min, générale 100/min,
  liste 120/min et identité 30/min. Sondes exemptées.
- Emails/chemins publics localisés, identifiants de code et routes API en anglais.
- Recherche insensible à la casse, jokers SQL littéraux et limite de 100 caractères ;
  pages de 20, retour aux pages précédentes dans le cache frontend.

Aucun domaine métier, OAuth, MFA, paiement, stockage ou tâche durable supplémentaire.
Better Auth RS reste alpha ; la migration des anciens comptes Nest est un chantier séparé.
