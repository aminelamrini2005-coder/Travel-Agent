# Étude d'accès aux plateformes — Skyscanner, BlaBlaCar, FlixBus, SNCF Connect, Trainline

> Date : 3 octobre 2026. Les conditions d'utilisation changent. **Relis la version en vigueur avant toute activation.**
> Certaines pages légales (legal.blablacar.com, connect.sncf.com) n'étaient pas accessibles depuis mon environnement. Pour elles, je cite des extraits indexés ou des CGU sœurs du même groupe. Ces points sont marqués ⚠️ « à revérifier ».

## Ordre de priorité appliqué

1. **API officielle** accessible.
2. **Open data, flux officiels ou API partenaire.**
3. **BrowserProvider** sur ta propre session connectée, **seulement** si c'est techniquement possible **et** compatible avec les conditions du service.

## Règles non négociables du BrowserProvider (implémentées dans le code)

- Un BrowserProvider est **désactivé par défaut**. Il ne s'active que si **les trois conditions** suivantes sont réunies :
  1. une fiche de conformité (`tosReview`) existe dans le code, avec `automationAllowed: true`, l'URL des CGU et la date de revue ;
  2. un opt-in explicite est présent dans `.env` (`BROWSER_PROVIDER_<ID>_ENABLED=true`) ;
  3. la fiche a moins de 180 jours.
- **Aucun mot de passe** n'est stocké. La session est celle d'un profil de navigateur local, **hors du repository** (`BROWSER_PROFILE_DIR`, en dehors du dépôt et listé dans `.gitignore`). Le code ne lit ni n'exporte jamais de cookies.
- **Aucun contournement** de CAPTCHA, d'anti-bot ou de rate limit. Si l'un d'eux est détecté, le provider s'arrête et renvoie `blocked` dans la trace. Il n'y a pas de nouvelle tentative automatique.
- Toute donnée récupérée par navigateur porte `accessMethod: "BROWSER"`, `source`, `checkedAt` et `sourceUrl` (l'URL de la page de résultats).

---

## 1. Skyscanner

| Critère | Constat |
|---|---|
| API publique | ❌ Pas d'API en libre-service. |
| Accès partenaire | ✅ **Skyscanner Partners** : Travel API (Live Prices, Indicative Prices, Autosuggest, Referrals). Sur candidature, pour des partenaires commerciaux. Les **Live Prices ne peuvent être appelés que sur une action utilisateur** (pas de préchargement automatique). Il existe aussi des widgets et des liens affiliés (referrals). |
| Session personnelle | Techniquement possible (pas besoin de compte pour chercher). Mais la session n'apporte aucun droit d'automatisation. |
| Contraintes techniques | Protection anti-bot forte (défi de type « press & hold » / HUMAN). Contenu rendu côté client. |
| CGU | Interdiction explicite d'utiliser « any unauthorised automated computer program, software agent, bot, spider […] to scan, copy, index […] » les services et leurs données. Une violation est qualifiée de « material breach », avec des mesures techniques et juridiques annoncées. |
| **Recommandation** | **Pas de BrowserProvider.** (a) Candidater au programme Partners / Travel API. (b) En attendant, Duffel pour les vols réels. (c) Possibilité légitime : un **lien de recherche Skyscanner pré-rempli** que l'utilisateur ouvre lui-même. La trace l'affiche « 🔗 lien proposé — non recherché ». |

Sources : [CGU Skyscanner](https://www.skyscanner.net/terms-of-service), [Usage guidelines API](https://developers.skyscanner.net/docs/getting-started/usage-guidelines), [Conditions des widgets partenaires](https://www.partners.skyscanner.net/affiliates/travel-widgets-terms-and-conditions).

## 2. BlaBlaCar (covoiturage)

| Critère | Constat |
|---|---|
| API publique | ⚠️ **Search API** (`public-api.blablacar.com/api/v3/trips`). Clé **sur demande** (quota initial annoncé : 1000 requêtes/jour). Je n'ai pas pu confirmer que de nouvelles clés sont encore délivrées en 2026. |
| Accès partenaire | Programme d'affiliation, liens profonds de recherche. |
| Session personnelle | Possible techniquement (compte, application). Mais la recherche ne nécessite pas de compte. |
| Contraintes techniques | Application web riche, protections anti-bot. |
| CGU | CGU BlaBlaCar Daily : interdiction d'« extraire ou tenter d'extraire (notamment à l'aide de robots d'aspiration de données […]) une partie substantielle des données de la Plateforme ». CGV BlaBlaCar Bus : pas de licence d'extraction ou de réutilisation de la base pour un usage commercial. ⚠️ CGU covoiturage principales à revérifier (page bloquée depuis mon environnement). |
| **Recommandation** | **Demander une clé Search API (priorité haute).** Pas de BrowserProvider. Les clauses anti-extraction visent précisément ce cas, et la clé officielle couvre le besoin. En attendant : provider mock + lien de recherche pré-rempli. |

Sources : [Support — comment utiliser l'API de recherche BlaBlaCar](https://support.blablacar.com/hc/en-gb/articles/360014200220--How-to-use-BlaBlaCar-search-API-), [CGU BlaBlaCar Daily](https://www.blablacardaily.com/terms), [CGV BlaBlaCar Bus](https://blog.blablacar.fr/conditions-generales-de-vente-de-transport-blablacar-bus).

## 3. FlixBus / FlixTrain

| Critère | Constat |
|---|---|
| API publique | ❌ Pas d'API de prix en libre-service. |
| Open data | ✅ **GTFS européen FlixBus + FlixTrain** sur transport.data.gouv.fr, licence **ODbL**, à jour (validité jusqu'en janvier 2027). Horaires théoriques, **sans prix**. |
| Accès partenaire | ✅ Programme partenaires : affiliation (Awin), widgets, **API et marque blanche pour les intégrations profondes**, sur contact. Code de conduite partenaire. |
| Session personnelle | Pas nécessaire pour chercher. Aucun droit d'automatisation lié à la session. |
| Contraintes techniques | Front-end dynamique, protections anti-bot. |
| CGU | ⚠️ Je n'ai pas trouvé de clause publique explicite sur l'extraction automatisée. Les règles partenaires encadrent strictement l'usage (marque, revente). En l'absence d'autorisation explicite, on considère l'automatisation **non autorisée**. |
| **Recommandation** | **OpenDataProvider GTFS (phase 2)** pour les horaires, prix `UNKNOWN`. En parallèle, **candidater au programme partenaire** pour l'API de prix. Pas de BrowserProvider. |

Sources : [GTFS FlixBus sur transport.data.gouv.fr](https://transport.data.gouv.fr/datasets/flixbus-horaires-theoriques-du-reseau-europeen-1?locale=en), [Programme partenaires FlixBus](https://global.flixbus.com/company/partners/affiliate-partners).

## 4. SNCF Connect

| Critère | Constat |
|---|---|
| API publique | ❌ Pas d'API publique de vente ou de prix temps réel pour SNCF Connect. |
| Open data / API officielle SNCF | ✅ **API SNCF (Navitia)** : token gratuit, horaires théoriques et temps réel, itinéraires, et **fourchettes tarifaires officielles** au mieux. ✅ **GTFS SNCF (TER, Intercités, TGV)** et jeux de données tarifaires sur transport.data.gouv.fr / data.sncf.com. |
| Accès partenaire | Distribution B2B (agences, revendeurs agréés). Contrat commercial. |
| Session personnelle | Compte SNCF Connect possible, mais la surveillance anti-robots des comptes est explicitement mentionnée dans les CGU du groupe. |
| Contraintes techniques | Anti-bot (type DataDome). Comptes surveillés contre les « robots, machines de piratage ». |
| CGU | Les CGU du groupe interdisent de perturber ou d'altérer le fonctionnement normal des services et mentionnent la détection des accès automatisés. ⚠️ CGU SNCF Connect à revérifier (page non accessible depuis mon environnement). |
| **Recommandation** | **APIProvider « API SNCF » (phase 2)** pour les horaires et le temps réel, prix `RANGE` ou `UNKNOWN`. OpenDataProvider GTFS en complément. Pas de BrowserProvider. Prix réels : seulement via un partenariat (Trainline ou distribution SNCF). Lien profond SNCF Connect pour la réservation. |

Sources : [API SNCF](https://numerique.sncf.com/startup/api/), [CGU SNCF Connect](https://connect.sncf.com/tos/FR_cgu.html), [CGU MonIdentifiant SNCF](https://www.monidentifiant.sncf/assets/CGU_fr.pdf).

## 5. Trainline

| Critère | Constat |
|---|---|
| API publique | ❌ Pas de portail développeur, pas de sandbox publique. |
| Accès partenaire | ✅ **Trainline Partner Solutions** (Global API) : **contrat commercial** via une prise de contact. Couvre les prix et la réservation des trains et cars européens. Programmes d'affiliation. |
| Session personnelle | Compte possible, mais les CGU interdisent tout extracteur sans accord écrit. |
| Contraintes techniques | Anti-bot. API interne non documentée. |
| CGU | Interdiction d'introduire « software or automated agents or scripts […] to strip, scrape, or mine data ». Tout système automatisé d'extraction, **y compris l'accès direct à l'API**, est interdit sans accord écrit préalable de Trainline. |
| **Recommandation** | **Partenariat Trainline Partner Solutions** : c'est la meilleure voie vers des **prix ferroviaires réels** européens. Pas de BrowserProvider. |

Sources : [CGU Trainline Partner Solutions](https://tps.thetrainline.com/terms-and-conditions/), [Produits TPS](https://tps.thetrainline.com/our-products/).

---

## Synthèse

| Plateforme | API officielle | Open data / partenaire | Browser (session perso) | Méthode retenue |
|---|---|---|---|---|
| Skyscanner | ❌ | Partenaire (candidature) | ❌ interdit par les CGU | Candidature Partners + lien pré-rempli |
| BlaBlaCar | ⚠️ sur demande | Affiliation | ❌ clause anti-extraction | **Demander la clé API** |
| FlixBus | ❌ | ✅ GTFS (ODbL) + partenaire | ❌ pas d'autorisation | **GTFS (phase 2)** + candidature partenaire |
| SNCF Connect | ✅ API SNCF (horaires) | ✅ GTFS + fourchettes | ❌ anti-robots | **API SNCF (phase 2)** |
| Trainline | ❌ | Partenaire (contrat) | ❌ interdit sans accord écrit | Candidature TPS |

**Conclusion honnête.** Pour ces cinq plateformes, **aucun BrowserProvider n'est compatible avec les conditions actuelles**. L'architecture le supporte (type `BROWSER`, garde-fous, traçabilité), mais aucun n'est activé. Le levier le plus efficace pour maximiser les sources est (1) l'open data dès la phase 2 et (2) les demandes d'accès partenaires, à lancer **maintenant** car elles prennent du temps.

Candidats futurs pour un BrowserProvider : des services dont les conditions autorisent explicitement l'automatisation personnelle, ou dont tu obtiens un **accord écrit**. Chaque candidat demandera une nouvelle fiche `tosReview`.
