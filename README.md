# Travel Agent AI

Assistant de voyage conversationnel qui cherche le meilleur trajet **porte-à-porte** en combinant plusieurs modes de transport (avion, train, car, covoiturage, transports locaux, marche, taxi) et plusieurs sources. Il construit lui-même ses itinéraires multimodaux. Il ne se limite pas à comparer des billets A → B sur une seule plateforme.

> **Statut : phase 2 (1re partie) terminée.** Premières **données réelles** : horaires open data **FlixBus/FlixTrain** (Europe) et **TIB Majorque** (GTFS), géocodage OpenStreetMap, taux BCE.
> Les prix de ces sources sont **inconnus** (`UNKNOWN`) et affichés comme tels. Les modes encore sans source réelle (vols, trains SNCF, covoiturage, bus locaux de la Côte d'Azur) utilisent des providers **fictifs en repli**. Chaque segment est badgé DONNÉE RÉELLE / DÉMO / ESTIMATION, et chaque trajet affiche sa couverture en données réelles.

Documents de référence :

- [`docs/PLAN.md`](docs/PLAN.md) : analyse, architecture, algorithme, plan par phases.
- [`docs/PROVIDER_ACCESS_STUDY.md`](docs/PROVIDER_ACCESS_STUDY.md) : étude d'accès à Skyscanner, BlaBlaCar, FlixBus, SNCF Connect et Trainline (API, open data, partenaire, navigateur, CGU).

---

## Démarrage rapide

Prérequis : Node.js ≥ 22. PostgreSQL et Redis sont **optionnels**.

```bash
npm install                 # installe et génère le client Prisma
cp .env.example .env        # puis compléter si besoin (aucune clé n'est obligatoire)
npm run gtfs:sync           # télécharge les horaires open data (FlixBus, TIB) dans data/gtfs/
npm run dev                 # http://localhost:3000
```

Sans `DATABASE_URL`, les conversations et recherches sont gardées en mémoire. Sans clé LLM, un analyseur local en français est utilisé.

### Avec PostgreSQL et Redis (recommandé)

```bash
docker compose up -d        # PostgreSQL 16 + Redis 7
# Dans .env :
#   DATABASE_URL="postgresql://travel:travel@localhost:5432/travel_agent"
#   REDIS_URL="redis://localhost:6379"
npm run db:migrate          # applique les migrations Prisma
npm run dev
```

### Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` puis `npm start` | Build et serveur de production |
| `npm test` | Tests unitaires et de scénario (Vitest) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript strict (`tsc --noEmit`) |
| `npm run check` | lint + typecheck + tests + build (à lancer avant chaque livraison) |
| `npm run db:migrate` / `db:deploy` | Migrations Prisma (dev / prod) |
| `npm run gtfs:sync [-- <feedId>]` | Télécharge / met à jour les flux GTFS (source officielle, sinon copie Mobility Database) |

---

## Variables d'environnement

Toutes les clés restent **côté serveur** : aucune n'est préfixée `NEXT_PUBLIC_`, et le code serveur est protégé par `server-only`. `.env` est ignoré par git ; seul `.env.example` est versionné.

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | non | PostgreSQL (sinon stockage mémoire) |
| `REDIS_URL` | non | Cache et rate limiting partagés (sinon mémoire) |
| `LLM_PROVIDER` | non | `auto` \| `anthropic` \| `openai` \| `none` |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | non | Compréhension du langage via Claude (défaut `claude-opus-5-5`) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | non | Alternative OpenAI |
| `MOCK_POLICY` | non | `fallback` (défaut) : démo uniquement là où aucune donnée réelle n'existe · `off` · `all` |
| `GTFS_DIR` | non | Dossier des flux GTFS (défaut `data/gtfs`) |
| `SNCF_API_TOKEN` | non | Active l'adapter API SNCF (Navitia) |
| `DUFFEL_ACCESS_TOKEN` | non | Active l'adapter Duffel (un jeton `duffel_test_` = offres fictives, affichées comme démo) |
| `TRANSITOUS_ENABLED`, `TRANSITOUS_CONTACT` | non | Transitous, à n'activer qu'après accord avec l'équipe |
| `NOMINATIM_ENABLED`, `NOMINATIM_CONTACT_EMAIL` | non | Géocodage OpenStreetMap (≤ 1 req/s, cache 30 j) |
| `ENABLE_ECB_RATES` | non | Taux de change BCE (défaut `true`) |
| `BROWSER_PROFILE_DIR` | non | Profil de navigateur **hors du dépôt** pour un futur BrowserProvider autorisé |
| `USER_TIMEZONE`, `RATE_LIMIT_PER_MINUTE`, `LOG_LEVEL` | non | Divers |

---

## Sources de données

| Source | Méthode | Statut | Prix |
|---|---|---|---|
| FlixBus / FlixTrain (GTFS européen) | Open data | ✅ actif (`npm run gtfs:sync`) | inconnu |
| TIB Majorque — bus, SFM (GTFS) | Open data | ✅ actif | inconnu |
| OpenStreetMap Nominatim | API publique | ✅ actif (lieux hors catalogue) | — |
| Taux BCE | Open data | ✅ actif | — |
| API SNCF (Navitia) | API | ⏳ adapter prêt, jeton requis | tarif de référence (RANGE) ou inconnu |
| Duffel (vols) | API | ⏳ adapter prêt, jeton requis | réel |
| Transitous (MOTIS) | Open data | ⏳ adapter prêt, désactivé (accord à obtenir) | inconnu |
| SNCF TER / TGV, Lignes d'Azur, Palmbus, Aix-Marseille (GTFS) | Open data | ✗ seule copie accessible périmée | — |
| BlaBlaCar, Google Routes | API | ⏳ emplacement prévu, clé requise | — |
| Skyscanner, Trainline, FlixBus (prix), ferries | Partenaire | ✗ accès partenaire nécessaire | — |
| Vols, trains, cars, covoiturage, bus locaux « Démo » | Mock | repli uniquement | fictif |

Pour ajouter une source : [`docs/ADDING_A_PROVIDER.md`](docs/ADDING_A_PROVIDER.md).

## Ce que fait le moteur

- **Conversation avec contexte** : « Marseille → Paris demain » → « seulement < 70 € » → « enlève les bus » → « finalement je peux partir 2 h plus tôt ». Chaque message produit un *patch* des paramètres précédents.
- **Résolution des lieux** : point d'intérêt (SKEMA Sophia Antipolis), ville, gare, aéroport, coordonnées GPS. Le géocodage Nominatim est optionnel.
- **Hubs atteignables** : depuis Vallauris, la recherche principale passe par Cannes, Antibes, Nice-Ville et l'aéroport de Nice. Marseille, Toulon et Gênes sont testés en alternatives. Même logique côté arrivée (Manacor → Palma).
- **Moteur multimodal** : recherche par labels multicritères sur un graphe temporel, avec front de Pareto (prix × arrivée × correspondances × départ), marges de correspondance configurables, élagage et limitation de la largeur de recherche.
- **Classement** : BEST (coût généralisé configurable), CHEAPEST, FASTEST, COMFORT. Chaque choix est accompagné d'une explication **calculée par le backend**.
- **AlternativeEngine** : au plus 6 recherches de variantes, au plus 3 alternatives affichées. Les variantes testées : autre hub de départ ou d'arrivée, départ plus tôt (si le départ n'est pas une contrainte ferme), budget relevé, arrivée plus tardive, autres modes, lendemain. Une alternative n'est retenue que si le gain est significatif.
- **Transparence** : une `SearchTrace` complète, visible dans « Ce que j'ai recherché » et « Voir toutes les recherches ». Elle indique pour chaque source ✓ recherché / ⚠ erreur / ✗ non recherché, la méthode d'accès (API, Open data, Navigateur, Calcul, Démo), les liaisons interrogées, les hubs testés, les trajets écartés avec leur raison et les variantes testées.
- **Prix** : niveau de confiance `REAL` / `RANGE` / `ESTIMATED` / `UNKNOWN`, total calculé sur **tous** les segments, montants en centimes, devises sans taux inventé.
- **Horaires** : stockés en UTC, avec le fuseau IANA de chaque lieu pour l'affichage. Aucune comparaison d'heures locales.
- **Robustesse** : appels aux providers en parallèle (`Promise.allSettled`), timeout par provider, cache avec TTL par provider, budget d'appels. Un provider en panne n'empêche jamais les résultats des autres.
- **API** : validation Zod, rate limiting basique, erreurs normalisées, logs JSON sans donnée sensible.

---

## Architecture

```
Message ──▶ IntentExtractor (LLM → patch Zod, repli : analyseur local)
        ──▶ applyPatch (état de conversation)
        ──▶ LocationResolver + HubCatalog (hubs atteignables)
        ──▶ QueryPlanner (paires de lieux × modes, élagage géographique)
        ──▶ ProviderRegistry (parallèle, timeout, cache, budget, validation, provenance)
        ──▶ runLabelSearch (graphe temporel, labels Pareto, règles de correspondance)
        ──▶ rankJourneys (BEST / CHEAPEST / FASTEST / COMFORT + explications)
        ──▶ AlternativeEngine (≤ 6 variantes réellement exécutées, ≤ 3 retenues)
        ──▶ SearchResult { journeys, ranking, alternatives, trace }
```

- `src/core/` : cœur métier en **TypeScript pur** (aucune dépendance à Next.js), testé isolément.
  - `types/` : schémas Zod et types (`TransportSegment`, `Journey`, `SearchParams`, `SearchTrace`…).
  - `time/`, `money/` : fuseaux horaires (Luxon) et montants en centimes.
  - `location/` : catalogue de hubs et de lieux, résolution, hubs atteignables, masses terrestres (îles).
  - `providers/` : interface commune, registre, `mock/`, `computed/` (marche, taxi estimé), `browser/` (base BrowserProvider et garde-fous), `declared-sources.ts` (plateformes connues non intégrées).
  - `engine/` : planificateur de requêtes, recherche par labels, règles de correspondance, construction des trajets, Pareto.
  - `ranking/`, `alternatives/`, `trace/`, `conversation/`, `search/`.
- `src/server/` : environnement, logs, LLM, persistance (Prisma ou mémoire), cache Redis, rate limiting, assemblage des dépendances.
- `src/app/` : interface Next.js et routes API. `src/components/` : interface mobile-first.
- `src/i18n/` : catalogue de messages (`fr`). Toutes les chaînes de l'interface et des explications y passent.
- `src/config/` : marges de correspondance, poids du classement, seuils des alternatives (tout est configurable).

### Méthodes d'accès aux sources (`accessMethod`)

| Méthode | Signification |
|---|---|
| `API` | API officielle ou partenaire |
| `OPEN_DATA` | Données ouvertes ou flux officiels (GTFS…) |
| `BROWSER` | Session personnelle de l'utilisateur, **seulement** si les CGU l'autorisent. Désactivé par défaut : il faut une revue des CGU datée, un opt-in dans `.env` et une session hors du dépôt. Aucun contournement de CAPTCHA, d'anti-bot ou de rate limit. |
| `COMPUTED` | Estimation calculée (marche, taxi) |
| `MOCK` | Données fictives de démonstration |

### Algorithme (résumé)

Les segments venant des API sont récupérés à la demande, par paire de lieux. RAPTOR et CSA supposent au contraire un horaire complet chargé en mémoire. Le moteur fait donc une **recherche par labels multicritères** (Martins généralisé) sur le petit graphe temporel construit à partir des réponses :

- chaque nœud garde un ensemble de labels non dominés (arrivée, coût, nombre de véhicules, départ effectif, prix inconnus) ;
- élagages : contraintes dures, marge de correspondance minimale, dominance locale, dominance par la destination, largeur de recherche bornée, attente maximale, nombre de segments maximal ;
- les segments flexibles (marche, taxi) sont recalés pour partir le plus tard possible.

Le transport public local pourra être délégué à un routeur spécialisé (MOTIS / Transitous, Navitia) exposé comme un provider. Détails dans [`docs/PLAN.md`](docs/PLAN.md) §6.

---

## API interne

| Endpoint | Description |
|---|---|
| `POST /api/chat` | `{ conversationId?, message }` → `{ conversationId, reply, params, result?, clarification? }` |
| `POST /api/search` | `SearchParams` structurés → `SearchResult` (sans LLM) |
| `GET /api/journeys/:id?searchId=` | Détail d'un trajet d'une recherche stockée (instantané horodaté) |
| `GET /api/searches/:id/trace` | Trace complète d'une recherche |
| `GET /api/providers` | Providers branchés et plateformes connues non intégrées |
| `GET /api/health` | État de la base, du cache, du LLM ; mocks actifs ou non |

Exemple :

```bash
curl -s -X POST localhost:3000/api/search -H 'content-type: application/json' -d '{
  "origin": {"text": "SKEMA Business School Sophia Antipolis"},
  "destination": {"text": "Manacor, Mallorca"},
  "earliestDeparture": "2026-10-16T15:00",
  "latestArrival": "2026-10-17T02:00",
  "objective": "cheapest",
  "departureFlexibility": "hard"
}'
```

Les dates sont des **heures locales** (`YYYY-MM-DDTHH:mm`), interprétées dans le fuseau de l'origine pour le départ et dans celui de la destination pour l'arrivée.

---

## Tests

`npm test` lance plus de 80 tests, notamment :

- correspondance impossible (train 17:30 → vol 18:00 avec 90 min requises : **rejeté**), correspondance risquée, marges configurables (sac à dos, bagage en soute, plancher utilisateur) ;
- prix total exact (2 + 14 + 39 + 6 = 61 €), durées, fuseaux et changement d'heure ;
- Pareto (50 €/8 h, 65 €/5 h et 120 €/4 h conservés), budget, nombre de correspondances, modes exclus, heure d'arrivée maximale, déduplication, absence de boucles ;
- classements CHEAPEST, FASTEST, BEST et COMFORT, explications calculées ;
- pertinence des alternatives (59 €/6 h 10 écarté face à 60 €/6 h ; 38 €/7 h et 78 €/3 h 45 gardés), limite de 6 recherches et de 3 alternatives ;
- isolation des pannes de providers (erreur, délai dépassé, anti-bot), cache, budget d'appels, provenance mock forcée ;
- garde-fous des BrowserProviders ;
- analyseur de langage naturel et conversation à plusieurs tours ;
- scénario complet SKEMA → Manacor : contraintes respectées, trace honnête, clés i18n existantes.

---

## Honnêteté des données (règles appliquées par le code)

1. Le LLM ne produit **jamais** d'horaire, de prix, de disponibilité ni de trajet. Il ne renvoie qu'un patch de contraintes, validé par Zod.
2. Un provider n'apparaît « ✓ recherché » que s'il existe une requête tracée réussie. Les plateformes non intégrées sont toujours affichées « ✗ non recherché », avec la raison.
3. Les données mock sont marquées par le registre lui-même : un provider mock ne peut pas déclarer de données réelles.
4. Les alternatives proviennent de recherches réellement exécutées, et leurs écarts sont calculés par le backend.
5. Un prix estimé ou inconnu est affiché comme tel (≈, « prix inconnu »). Le score de fiabilité est présenté comme une estimation, jamais comme une garantie.

---

## Feuille de route

- **Phase 2** : première vraie source d'horaires (Transitous / MOTIS : TER, réseaux locaux, FlixBus GTFS, TIB Majorque), puis API SNCF. Géocodage Nominatim.
- **Phase 3** : vols réels (Duffel), taux BCE, partenariats trains et cars selon les accès obtenus.
- **Phase 4** : covoiturage (clé BlaBlaCar), Google Routes en option, ferries si une source existe.
- **Phase 5** : MOTIS auto-hébergé, historiques de retard, préférences apprises, bagages et frais annexes, réservation intégrée.
