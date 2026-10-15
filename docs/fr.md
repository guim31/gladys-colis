# Suivi de colis (17TRACK, DHL)

Suivez dans Gladys vos colis de **tous les transporteurs**, en France comme à l'étranger : UPS, FedEx, USPS, DHL,
Deutsche Post, GLS, DPD, Mondial Relay, Royal Mail, les postes du monde entier, les envois venus de Chine (Cainiao,
YunExpress…) et plus de 3 000 autres, à la manière des applications de suivi de colis.

> **Développée sans compte 17TRACK ni DHL** : vos retours sont les bienvenus sur le
> [forum Gladys](https://community.gladysassistant.com/). Les réponses des deux API ont été simulées d'après leur
> documentation.

Pour vos colis **La Poste, Colissimo et Chronopost**, préférez l'intégration
[La Poste](https://github.com/guim31/gladys-laposte) (`guim31/gladys-laposte`), qui lit l'API officielle de La Poste.

Cette intégration n'est affiliée ni aux transporteurs ni à 17TRACK.

## Ce que fait l'intégration

- Vous ajoutez un colis par son numéro de suivi, et un nom si vous voulez (« Chaussures de course »), depuis la
  configuration ou depuis une scène. Le transporteur est reconnu tout seul d'après le numéro.
- Deux sources, chacune activée par sa clé gratuite :
  - **DHL**, par son API officielle, pour les numéros DHL et Deutsche Post ;
  - **17TRACK** pour tout le reste : il reconnaît le transporteur et rassemble les étapes de tous les transporteurs
    du trajet (la poste chinoise puis La Poste, par exemple) en une seule chronologie.
- Chaque colis devient un **appareil** dans Gladys : statut, dernière étape, lieu, date, transporteur et date de
  livraison prévue.
- Le statut est **le même pour tous les transporteurs** : enregistré, en transit, en livraison, à retirer, problème,
  livré. Le texte d'origine du transporteur (souvent en anglais ou en allemand) reste visible en détail.
- Le widget « Mes colis » liste vos colis, ceux qui vous attendent en premier.
- Trois déclencheurs de scène (en cours de livraison, livré, colis qui demande votre attention) et trois actions de
  scène (suivre un colis, arrêter de suivre un colis, lire l'état de mes colis).
- Un colis livré est archivé tout seul au bout de 7 jours (réglable).

## Prérequis

- Gladys 5.1.0 ou plus récent, avec un accès à Internet.
- Au moins une des deux clés, gratuites :
  - **17TRACK** (tous transporteurs) : créez un compte sur [api.17track.net](https://api.17track.net/en), puis
    copiez la clé dans **Settings → Security → Access key**. Si vous activez la liste blanche d'adresses IP, ajoutez-y
    l'adresse publique de votre box, sinon 17TRACK refuse la clé.
  - **DHL** (colis DHL et Deutsche Post) : créez un compte sur
    [developer.dhl.com](https://developer.dhl.com/), créez une application avec l'API **Shipment Tracking -
    Unified**, et copiez son **API Key** (pas le secret).
- Les deux ensemble donnent le meilleur résultat : DHL lit ses colis directement, 17TRACK fait le reste.

## Configuration

Installez l'intégration depuis **Intégrations → Installer depuis GitHub** avec l'adresse
`https://github.com/guim31/gladys-colis`, puis ouvrez sa configuration.

| Réglage                 | Défaut   | Rôle                                                                                    |
| ----------------------- | -------- | --------------------------------------------------------------------------------------- |
| Clé d'API 17TRACK       | (vide)   | Votre clé 17TRACK. Elle n'apparaît jamais dans les journaux.                            |
| Clé d'API DHL           | (vide)   | L'API Key de votre application DHL. Elle n'apparaît jamais dans les journaux.           |
| Garder les colis livrés | 7 jours  | Un colis livré est archivé après ce délai (1 à 30 jours).                               |
| Langue                  | Français | Langue des statuts, des noms de fonctionnalités des nouveaux appareils et des messages. |

Les actions de la configuration :

- **Suivre un colis** : le numéro de suivi (les espaces, points et tirets sont acceptés) et un nom facultatif. Le
  colis est lu tout de suite. Le même numéro avec un autre nom renomme le colis. Créez ensuite son appareil dans
  l'onglet **Découverte**.
- **Arrêter de suivre un colis** : par son nom ou son numéro. Son appareil reste dans Gladys : supprimez-le depuis la
  page de l'appareil.
- **Relire les colis maintenant** : lit tout de suite chaque colis en cours, vérifie les clés, et indique le quota
  17TRACK restant et les requêtes DHL utilisées dans la journée.

## Quotas et rythme de lecture

L'intégration lit chaque colis à un rythme qui suit son statut, sans jamais dépasser les offres gratuites :

| Statut                      | Lecture               |
| --------------------------- | --------------------- |
| En livraison                | toutes les 15 minutes |
| En transit, problème        | toutes les heures     |
| À retirer, pas encore connu | toutes les 2 heures   |
| Enregistré                  | toutes les 3 heures   |
| Livré                       | plus jamais           |

- **DHL** : l'offre gratuite autorise 250 requêtes par jour et une toutes les 5 secondes. L'intégration s'arrête à
  240 par jour, espace ses requêtes de 5 secondes, et ralentit le rythme quand beaucoup de colis DHL se partagent la
  journée (20 colis DHL en transit : un peu plus de 2 heures entre deux lectures). Une fois les 240 requêtes faites,
  les colis DHL attendent le lendemain (minuit UTC).
- **17TRACK** : seul l'**enregistrement** d'un nouveau numéro consomme du quota, une fois par colis ; les lectures
  suivantes sont gratuites et groupées (40 numéros par requête, 3 requêtes par seconde au plus). L'offre gratuite
  donne un nombre limité d'enregistrements : selon le centre d'aide de 17TRACK, 200 numéros offerts une seule fois aux
  comptes ouverts depuis janvier 2026 (100 par mois sur des comptes plus anciens). Vérifiez votre tableau de bord
  17TRACK : l'action « Relire les colis maintenant » affiche ce qui reste. Un colis archivé puis suivi à nouveau ne
  consomme rien.
- 17TRACK lit lui-même les transporteurs de son côté : juste après l'enregistrement, il faut parfois quelques minutes
  avant les premières étapes.

## Les appareils

Un appareil par colis, nommé d'après le colis (« Chaussures de course (1Z999AA10123456784) »), à créer dans l'onglet
**Découverte**. Ses fonctionnalités, toutes en lecture seule :

| Fonctionnalité   | Contenu                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Statut           | Pas encore lu, Pas encore connu, Enregistré, En transit, En livraison, À retirer, Problème, Livré |
| Dernière étape   | Le texte du transporteur, tel qu'il l'envoie                                                      |
| Lieu             | Le lieu de la dernière étape                                                                      |
| Date de l'étape  | Date et heure de la dernière étape                                                                |
| Transporteur     | UPS, DHL Paket, La Poste, Cainiao…                                                                |
| Livraison prévue | La date annoncée par le transporteur, si elle existe                                              |

Un tiret (—) remplace une information que le transporteur ne donne pas. Les noms des fonctionnalités prennent la
langue choisie au moment de la création de l'appareil.

Quand le colis est archivé, il quitte l'onglet Découverte mais son appareil reste dans Gladys avec ses dernières
valeurs : supprimez-le quand vous n'en avez plus besoin (Gladys ne laisse pas une intégration supprimer un appareil).

## Le widget

Ajoutez le widget **Mes colis** à votre tableau de bord. Il liste jusqu'à 8 colis : d'abord ceux en livraison, à
retirer ou en difficulté, puis les autres. Chaque ligne donne le nom, la dernière étape et sa date, et un badge de
statut en couleur. Un appui ouvre le détail : transporteur, numéro, date de livraison prévue, historique des étapes
et lien vers la page de suivi. Une ligne en bas signale une clé refusée, un quota atteint ou un service qui ne répond
pas.

## Déclencheurs de scène

| Déclencheur                        | Quand                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Un colis est en cours de livraison | Le livreur a pris le colis pour sa tournée du jour.                                                           |
| Un colis est livré                 | Le transporteur indique le colis livré (pas pour un colis déjà livré à son ajout).                            |
| Un colis demande votre attention   | Le colis attend en point relais ou en consigne, ou a un problème (livraison manquée, douane, retard, retour). |

Chaque déclencheur peut se limiter à un colis (vide : tous les colis). « Un colis demande votre attention » peut aussi
se limiter à un motif : « À retirer » ou « Problème ». Les informations transmises aux actions de la scène : nom du
colis, numéro, transporteur, statut, dernière étape, lieu et page de suivi (et le motif).

Un déclencheur part une seule fois par changement de statut : un redémarrage de Gladys ou de l'intégration ne le
relance pas.

## Actions de scène

- **Suivre un colis** : ajoute un colis. Le champ numéro accepte aussi un texte entier, comme l'objet d'un mail de
  confirmation de commande : le premier numéro de suivi qu'il contient est retenu. Résultats : numéro, nom, statut,
  transporteur, et « Nouveau colis » (1 ou 0).
- **Arrêter de suivre un colis** : par son nom ou son numéro. Résultat « Retiré » : 1, ou 0 si aucun colis ne
  correspond.
- **Lire l'état de mes colis** : une phrase comme « Vous avez 2 colis en cours : Chaussures, en cours de livraison
  aujourd'hui ; Livre, à retirer. », et les nombres de colis en cours, en livraison, à retirer et en difficulté.

## Exemples de scènes

- **Le livreur arrive** : déclencheur « Un colis est en cours de livraison », action « Envoyer un message » : « Le
  colis {nom du colis} arrive aujourd'hui ({transporteur}) ». Ajoutez une condition de présence pour ne prévenir que
  si personne n'est à la maison.
- **Penser au point relais** : déclencheur « Un colis demande votre attention », motif « À retirer », puis un message
  « {nom du colis} vous attend : {dernière étape} ».
- **Le point du matin** : déclencheur horaire à 8 h, action « Lire l'état de mes colis », puis « Continuer seulement
  si » colis en cours > 0, et une annonce vocale de la phrase.
- **Suivi automatique depuis vos mails** : avec une intégration de messagerie, passez l'objet du mail d'expédition à
  l'action « Suivre un colis ».

## Dépannage

- **« 17TRACK refuse la clé d'API »** : vérifiez la clé (Settings → Security). Si la liste blanche d'adresses IP est
  activée sur 17TRACK, ajoutez l'adresse publique de votre box, ou désactivez-la.
- **« DHL refuse la clé d'API »** : copiez l'**API Key** de l'application (pas l'« API Secret ») et vérifiez que
  l'application a bien l'API « Shipment Tracking - Unified ».
- **Un colis reste « Pas encore connu »** : l'expéditeur a créé l'étiquette mais n'a pas encore remis le colis, ou
  17TRACK ne reconnaît pas le transporteur. L'intégration réessaie, puis archive le numéro au bout de 30 jours.
- **« Quota 17TRACK atteint »** : il n'y a plus d'enregistrement gratuit sur votre compte ; les colis déjà suivis
  continuent d'être lus. Retirez les colis qui ne servent plus.
- **« Lectures DHL du jour épuisées »** : les 240 requêtes du jour sont faites ; les colis DHL reprennent à minuit
  UTC.
- **L'appareil n'affiche rien** : créez-le dans l'onglet Découverte, puis attendez la lecture suivante ou utilisez
  « Relire les colis maintenant ».
- Pour plus de détails, passez le niveau des journaux en `debug` (variable `LOG_LEVEL=debug`) : chaque lecture y est
  décrite, sans jamais afficher les clés.

## Limites

- Développée sans compte 17TRACK ni DHL : les réponses ont été simulées d'après la documentation des deux API. Les
  premiers retours réels sont attendus.
- Le statut « En livraison » et « À retirer » de DHL est déduit du texte de l'étape (anglais ou allemand) : une
  formulation nouvelle peut rester classée « En transit ».
- Les textes des étapes restent dans la langue du transporteur.
- Les déclencheurs suivent le rythme de lecture : « en cours de livraison » peut arriver jusqu'à une heure après la
  prise en charge par le livreur.
- 40 colis suivis au plus.
- UPS, FedEx et USPS ont aussi des API officielles, mais elles demandent un compte professionnel et une
  authentification OAuth : ces transporteurs passent par 17TRACK.
- Les transporteurs qui exigent un code postal ou un téléphone pour le suivi ne sont pas pris en charge.
