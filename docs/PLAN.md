# Travel Agent AI — Analyse, architecture et plan d'implémentation

> Statut : **proposition à valider**. Aucun code applicatif n'est écrit avant validation.
> Date de l'analyse : 3 octobre 2026.

---

## 1. Analyse du produit

### 1.1 Ce que le produit est vraiment

Un **planificateur porte-à-porte multimodal** avec une couche conversationnelle. Trois composants portent la valeur :

1. **Le moteur d'itinéraires** : il assemble lui-même des trajets à partir de segments venant de sources hétérogènes (vols, trains, cars, covoiturage, transports locaux, marche, taxi).
2. **Le moteur d'alternatives** : il répond à la question « une petite modification de ma demande donnerait-elle quelque chose de nettement mieux ? » en lançant de vraies recherches supplémentaires, dans un budget limité.
3. **La transparence** : un `SearchTrace` factuel qui dit ce qui a été cherché, ce qui a échoué et ce qui n'a pas été cherché.

Le LLM est **périphérique** : il traduit le langage naturel en contraintes structurées et reformule des résultats déjà calculés. Il ne produit jamais un horaire, un prix ou une disponibilité.

### 1.2 Ce qui distingue le produit

| Comparateur classique | Travel Agent AI |
|---|---|
| A → B sur une plateforme | A → hubs → B, sur plusieurs plateformes |
| Tri par prix | Front de Pareto (prix × durée × correspondances), puis profils |
| L'utilisateur relance lui-même les variantes | Variantes testées automatiquement (hub voisin, horaire, budget, jour) |
| « Nous avons cherché partout » | Trace exacte : ✓ / ⚠ / ✗ par source et par route |

---

## 2. Difficultés techniques (par ordre de risque)

1. **Accès aux données commerciales (risque n°1).** Les horaires sont largement ouverts (GTFS), mais les **prix en temps réel** le sont très peu. Trains SNCF, Trainline, FlixBus, Ryanair et easyJet n'offrent pas d'API de prix publique en libre-service. C'est une contrainte métier, pas un problème de code. L'architecture doit donc gérer nativement un **niveau de confiance du prix** (`quoted` / `range` / `estimate` / `unknown`).
2. **Explosion combinatoire.** Avec 6 hubs de départ, 3 hubs d'arrivée, 5 modes et des fenêtres horaires, le nombre d'appels API possibles est très grand. Il faut un **planificateur de requêtes** borné, distinct de l'algorithme de graphe.
3. **Optimisation multicritère.** Un Dijkstra classique optimise un seul critère. Il faut des **ensembles de labels Pareto** par nœud.
4. **Fuseaux horaires.** Nice et Palma sont dans le même fuseau, mais le produit doit être correct en général : tous les instants sont stockés en UTC, avec le fuseau IANA de chaque lieu pour l'affichage.
5. **Modes flexibles et modes planifiés.** Un vol part à 18:00. Un taxi ou la marche partent quand on veut. Le graphe doit mélanger des arêtes horodatées et des arêtes de durée.
6. **Billets séparés.** Si on rate le vol à cause d'un TER en retard, rien n'est protégé. Le score de fiabilité doit pénaliser ce cas explicitement.
7. **Conversation à état.** « Enlève les bus » doit modifier la recherche précédente. Le LLM produit donc un **patch** des paramètres, pas une nouvelle requête complète.
8. **Honnêteté de l'interface.** Chaque segment porte `source`, `is_mock`, `price_confidence` et `checked_at`, du provider jusqu'au rendu, sans perte.
9. **Coût et latence.** Appels en parallèle, timeouts par provider, cache avec TTL par provider, budget d'alternatives.

---

## 3. Sources de données — ce qui est réellement utilisable

Vérifié le 3 octobre 2026. « Libre-service » signifie qu'une inscription en ligne suffit, sans contrat.

### 3.1 Vols

| Source | Statut | Utilisable ? |
|---|---|---|
| **Duffel** | API en libre-service. Mode test gratuit (« Duffel Airways », données fictives). Mode live facturé à l'usage (~3 $ par commande, plus des frais si le ratio recherches/réservations dépasse 1500:1). | ✅ **Meilleur candidat** pour des offres réelles. La couverture low-cost est à vérifier sur ton compte : Ryanair notamment n'est généralement pas distribué. |
| **Amadeus Self-Service** | **Fermé le 17 juillet 2026** : clés désactivées, inscriptions closes. Seul l'Enterprise (contrat) subsiste. | ❌ Ne pas intégrer. |
| **Kiwi Tequila** | Libre-service fermé depuis 2024. Partenariats B2B sur invitation. | ❌ Seulement via un partenariat. |
| **Skyscanner** | API partenaires/affiliés sur candidature. | ⏳ Interface prête, intégration après accord. |
| **Travelpayouts (Aviasales) Data API** | Affiliation gratuite. Prix **en cache**, pas en temps réel. | ⚠️ Possible comme indication de prix, toujours étiquetée « prix indicatif (cache) ». |
| Ryanair, easyJet, Vueling (direct) | Pas d'API publique. Le scraping est contraire à leurs CGU. | ❌ Aucun scraping. Lien profond de réservation uniquement. |

### 3.2 Trains

| Source | Statut | Utilisable ? |
|---|---|---|
| **API SNCF (Navitia)** — numerique.sncf.com | Token gratuit avec quota mensuel. Horaires théoriques et temps réel, calcul d'itinéraires. **Pas de prix dynamiques** : au mieux une fourchette tarifaire officielle. | ✅ Pour les horaires et le temps réel. Prix = `range` ou `unknown`. |
| **GTFS SNCF / TER** — transport.data.gouv.fr | Open data. | ✅ Horaires, sans prix. |
| **Trainline** | API partenaires uniquement. | ⏳ Interface prête. |
| SNCF Connect (prix temps réel) | Pas d'API publique. Distribution B2B uniquement. | ❌ Aucun scraping. |

### 3.3 Cars et bus

| Source | Statut | Utilisable ? |
|---|---|---|
| **FlixBus / FlixTrain GTFS** — transport.data.gouv.fr | Open data, licence ODbL. Réseau européen complet, à jour (validité jusqu'en janvier 2027). | ✅ Horaires, sans prix. |
| FlixBus API (prix) | Partenaires/affiliés uniquement. | ⏳ |
| **BlaBlaCar Bus API** | Historiquement gratuite sur clé. **Le domaine `bus-api.blablacar.com` ne résout plus** lors de mon test. | ⚠️ À confirmer : il faudra contacter BlaBlaCar. |
| Réseaux locaux (Lignes d'Azur, Zou!, Envibus, Palmbus…) | GTFS sur transport.data.gouv.fr. | ✅ |
| **TIB Mallorca (CTM)** | GTFS officiel, licence CC-BY 4.0. | ✅ Palma ↔ Manacor couvert. |

### 3.4 Covoiturage

| Source | Statut | Utilisable ? |
|---|---|---|
| **BlaBlaCar Search API** (`public-api.blablacar.com/api/v3`) | Clé sur demande auprès de BlaBlaCar (quota initial annoncé : 1000 requêtes/jour). Je n'ai pas pu confirmer que les nouvelles demandes sont encore acceptées. | ⚠️ Faire la demande. En attendant, provider mock. |

### 3.5 Transport public multimodal (agrégateurs)

| Source | Statut | Utilisable ? |
|---|---|---|
| **Transitous** (MOTIS, api.transitous.org) | Gratuit, communautaire, couverture européenne via GTFS. Réservé aux projets **open source et non commerciaux**, avec User-Agent identifié, cache obligatoire et contact préalable pour un usage intensif du routage. Aucune garantie de service. | ✅ Pour le prototype. ⚠️ En production commerciale : **auto-héberger MOTIS** (open source) avec les mêmes GTFS. |
| **Google Routes API** (TRANSIT) | Clé avec facturation. Itinéraires transit mondiaux. `transitFare` est fourni seulement si le prix est connu pour toutes les étapes. Les CGU limitent le stockage des résultats. | ✅ En option, payant. |

### 3.6 Ferries, taxi, VTC

| Source | Statut |
|---|---|
| Ferries (Baleària, Corsica Ferries…) | Pas d'API publique connue. Direct Ferries propose un programme partenaire. Les GTFS ferry existent parfois sans prix. → Interface prête. Affiché « ✗ Ferry — aucune source disponible ». |
| Taxi | Pas d'API de prix. Les **tarifs taxi en France sont réglementés** (arrêtés préfectoraux publics), donc une **estimation** est calculable à partir de la distance. Toujours affichée comme `estimate`. |
| Uber / Bolt | API restreintes aux partenaires. → Interface prête. |

### 3.7 Services transverses

| Besoin | Source | Remarque |
|---|---|---|
| Géocodage | **Nominatim** (OSM) | Gratuit. Politique d'usage : 1 req/s maximum, cache obligatoire, User-Agent. Google Geocoding et Mapbox sont des alternatives payantes. |
| Temps de trajet routier | OSRM ou OpenRouteService, sinon estimation à vol d'oiseau × facteur de détour | La 1re phase utilise l'estimation, marquée `estimate`. |
| Taux de change | **BCE** (taux de référence quotidiens, gratuits), ou Frankfurter (miroir de la BCE) | Les taux ne sont jamais inventés. Si le taux manque, la conversion est refusée et signalée. |
| LLM | Anthropic (Claude) et/ou OpenAI | Derrière une interface `LlmClient`. |

### 3.8 Conclusion honnête sur les données

- **Horaires** : très bien couverts dès la phase 2 (Transitous ou MOTIS, SNCF, GTFS FlixBus et TIB).
- **Prix réels** : bien couverts pour les **vols** (Duffel). Pour **trains, cars et covoiturage**, il faut des partenariats (Trainline, FlixBus, BlaBlaCar) ou accepter des prix `range`/`estimate` clairement étiquetés.
- Le scénario cible « Covoiturage + TER, 31 €, avec liens de réservation » exige au minimum l'accès BlaBlaCar et une source de prix SNCF. **Ces deux accès dépendent de démarches commerciales, pas de développement.**

---

## 4. Architecture

### 4.1 Choix de stack

- **Une seule application Next.js** (App Router, TypeScript strict, Tailwind). Les routes API sont côté serveur. Pas de backend séparé en phase 1 : rien ne le justifie.
- **Le cœur métier est du TypeScript pur** dans `src/core/` (aucune dépendance Next.js). Il est testable isolément et pourra être déplacé dans un worker plus tard si nécessaire.
- **Zod** pour toutes les frontières : API, LLM, providers.
- **PostgreSQL + Prisma** pour les conversations, recherches, traces et préférences. Fourni via `docker-compose`.
- **Cache** : interface `Cache`. Implémentation mémoire (LRU + TTL) par défaut, adaptateur Redis activé si `REDIS_URL` est défini. Redis n'est pas obligatoire en développement.
- **Luxon** pour les fuseaux horaires (IANA). **Vitest** pour les tests.
- **LLM** : interface `LlmClient` avec les implémentations `AnthropicClient` et `OpenAIClient`, plus un **parser déterministe de secours** (règles et regex) pour développer et tester sans clé.

### 4.2 Flux d'une requête

```
Utilisateur ──▶ POST /api/chat
                 │
                 ▼
     ┌──────────────────────────┐
     │ IntentExtractor (LLM)     │  message + SearchParams précédents
     │  → SearchParamsPatch (Zod)│  → patch validé (jamais de prix/horaires)
     └────────────┬─────────────┘
                  ▼
     ┌──────────────────────────┐
     │ LocationResolver          │  texte → Place {lat, lon, tz, kind}
     │  + HubCatalog             │  → hubs atteignables (départ et arrivée)
     └────────────┬─────────────┘
                  ▼
     ┌──────────────────────────┐
     │ QueryPlanner              │  quelles paires (hub A, hub B, mode) interroger,
     │                           │  avec quelles fenêtres horaires (budget borné)
     └────────────┬─────────────┘
                  ▼
     ┌──────────────────────────┐
     │ ProviderRegistry          │  Promise.allSettled + timeout par provider
     │  + Cache (TTL/provider)   │  → TransportSegment[] + ProviderCallRecord[]
     └────────────┬─────────────┘
                  ▼
     ┌──────────────────────────┐
     │ JourneyEngine             │  graphe temporel, labels Pareto,
     │  + ConnectionRules        │  règles de correspondance, élagage
     └────────────┬─────────────┘
                  ▼
     ┌──────────────────────────┐
     │ Ranker                    │  BEST / CHEAPEST / FASTEST / COMFORT
     │  + Explainer (backend)    │  phrases « pourquoi » calculées
     └────────────┬─────────────┘
                  ▼
     ┌──────────────────────────┐
     │ AlternativeEngine         │  SearchVariants → vraies recherches
     │  (≤ 6 recherches, ≤ 3     │  → alternative_score → top 3
     │   alternatives visibles)  │
     └────────────┬─────────────┘
                  ▼
     SearchResult { journeys, alternatives, trace } ──▶ UI
                  │
                  └──▶ (optionnel) LLM reformule le résumé
                       à partir des chiffres calculés uniquement
```

Le `SearchTrace` est alimenté à **chaque étape** par un `TraceRecorder` passé explicitement. Rien n'est reconstitué après coup.

### 4.3 Providers

```ts
interface TransportProvider {
  readonly id: string;                 // "duffel", "sncf", "mock-flights"…
  readonly displayName: string;
  readonly modes: TransportMode[];     // modes couverts
  readonly isMock: boolean;
  readonly cacheTtlSeconds: number;
  readonly priceConfidence: PriceConfidence; // niveau maximal fourni
  /** Indique si le provider sait répondre à cette paire (couverture géographique). */
  supports(query: SegmentQuery): boolean;
  search(query: SegmentQuery, ctx: ProviderContext): Promise<TransportSegment[]>;
}
```

- `SegmentQuery` = { origin: Place, destination: Place, departureWindow: [from, to], modes, passengers }.
- `ProviderContext` = { signal (AbortSignal), logger, now }.
- Le `ProviderRegistry` filtre les providers selon `supports()` et les modes demandés, puis exécute tout en parallèle (`Promise.allSettled`, timeout par provider). Il produit un `ProviderCallRecord` par appel : `ok` / `error` / `timeout` / `skipped` (avec la raison).
- **Providers « calculés »** : `WalkProvider` et `TaxiEstimateProvider` ne sont pas commerciaux. Ils calculent à partir de la distance et produisent `price_confidence: "estimate"`.
- Pour les plateformes sans API (Ryanair, SNCF Connect…), **aucune classe n'est créée**. Elles figurent seulement dans un **registre de sources déclarées** (`status: "not_integrated"`, avec la raison) pour que la trace affiche « ✗ non recherché » de façon honnête.

---

## 5. Schéma de données

### 5.1 Types métier (Zod / TypeScript)

```ts
type TransportMode =
  | "flight" | "train" | "regional_train" | "high_speed_train" | "coach"
  | "bus" | "metro" | "tram" | "ferry" | "rideshare" | "taxi" | "vtc"
  | "walk" | "car_rental";

type PlaceKind = "address" | "city" | "station" | "airport" | "bus_station"
               | "port" | "poi" | "coordinates";

interface Place {
  id: string;               // "hub:NCE", "geo:43.62,7.04", "osm:node/123"
  name: string;
  kind: PlaceKind;
  lat: number; lon: number;
  timezone: string;         // IANA : "Europe/Paris"
  codes?: { iata?: string; uic?: string; gtfsStopIds?: string[] };
  countryCode?: string;
}

type PriceConfidence = "quoted" | "range" | "estimate" | "unknown";

interface Money { amountMinor: number; currency: string } // centimes, pas de float

interface TransportSegment {
  id: string;                    // hash stable (pour la déduplication)
  provider: string;              // id du provider
  operator?: string;             // "easyJet", "SNCF TER", "Zou!"
  mode: TransportMode;
  origin: Place; destination: Place;
  departureTime: string;         // ISO 8601 UTC
  arrivalTime: string;           // ISO 8601 UTC
  flexibleDeparture: boolean;    // true pour marche/taxi : départ à tout moment
  durationMinutes: number;
  price: Money | null;
  priceRange?: { min: Money; max: Money };
  priceConfidence: PriceConfidence;
  bookingUrl: string | null;
  realtime: boolean;             // horaires temps réel ou théoriques
  availability: "available" | "limited" | "sold_out" | "unknown";
  seatsLeft?: number;
  isMock: boolean;
  checkedAt: string;             // ISO UTC, instant de l'appel au provider
  sourceRef?: string;            // référence opaque (offer_id…) pour la réservation
  details?: { flightNumber?: string; terminal?: string; line?: string;
              checkedBaggageIncluded?: boolean };
}

interface Connection {           // entre deux segments consécutifs
  fromSegmentId: string; toSegmentId: string;
  waitMinutes: number;
  requiredMinutes: number;       // issu des ConnectionRules
  slackMinutes: number;          // wait - required
  separateTickets: boolean;
  risk: "low" | "medium" | "high";
  notes: string[];               // ex. "changement de terminal", "bagage à récupérer"
}

interface Journey {
  id: string;
  segments: TransportSegment[];
  connections: Connection[];
  totalPrice: Money | null;      // null si un segment a un prix inconnu
  priceBreakdown: { segmentId: string; price: Money | null; confidence: PriceConfidence }[];
  totalPriceConfidence: PriceConfidence; // le plus faible des segments
  departureTime: string; arrivalTime: string;
  totalDurationMinutes: number;
  transfers: number;
  walkingMinutes: number;
  waitingMinutes: number;
  reliabilityScore: number;      // 0..1, jamais présenté comme une garantie
  riskLevel: "low" | "medium" | "high";
  bookingLinks: { segmentId: string; url: string; provider: string }[];
  containsMockData: boolean;
  modesSummary: TransportMode[];
}
```

### 5.2 Paramètres de recherche et préférences

```ts
interface SearchParams {
  origin: LocationQuery;         // texte brut ou coordonnées, résolu ensuite
  destination: LocationQuery;
  earliestDeparture?: string;    // ISO avec offset, ou date et heure + tz
  latestDeparture?: string;
  latestArrival?: string;
  objective: "best" | "cheapest" | "fastest" | "comfort";
  maxBudget?: Money;
  maxTransfers?: number;
  includedModes: TransportMode[] | "all";
  excludedModes: TransportMode[];
  passengers: number;
  luggage: "backpack" | "cabin" | "checked";
  tradeoff?: { eurosPerHourSaved?: number }; // « 20 € de plus si je gagne 2 h »
  currency: string;              // "EUR" par défaut
}

interface UserPreferences {
  maxBudget?: Money; maxTransfers?: number;
  preferredModes: TransportMode[]; excludedModes: TransportMode[];
  walkingToleranceMinutes: number;
  minimumConnectionBufferMinutes?: number;
  hasCheckedBaggage: boolean;
  comfortVsPrice: number;        // 0..1
  priceVsSpeed: number;          // 0..1, ou valeur du temps en €/h
}

// Patch produit par le LLM pour la conversation (« enlève les bus »)
type SearchParamsPatch = Partial<SearchParams> & {
  addExcludedModes?: TransportMode[];
  removeExcludedModes?: TransportMode[];
  shiftDepartureMinutes?: number;   // « je peux partir 2 h plus tôt » → -120
  reset?: boolean;                  // nouvelle recherche sans rapport avec la précédente
};
```

### 5.3 Trace et alternatives

```ts
interface SearchTrace {
  searchId: string;
  startedAt: string; completedAt: string;
  interpretedParams: SearchParams;          // ce qui a réellement été cherché
  resolvedOrigin: Place; resolvedDestination: Place;
  originHubsConsidered: HubConsideration[];  // hub, temps d'accès estimé, retenu ou non + raison
  destinationHubsConsidered: HubConsideration[];
  providers: {
    providerId: string; displayName: string; isMock: boolean;
    status: "success" | "error" | "timeout" | "skipped" | "not_integrated";
    modes: TransportMode[]; calls: number; resultCount: number;
    durationMs: number; error?: string; reason?: string;
  }[];
  queries: {                                 // chaque appel réel
    providerId: string; mode: TransportMode;
    from: string; to: string; window: [string, string];
    status: "success" | "error" | "timeout" | "cache_hit";
    resultCount: number; durationMs: number;
  }[];
  routePatternsTested: string[];             // « Vallauris → Nice Airport → Palma → Manacor »
  rejected: { summary: string; reason: RejectionReason; detail: string }[]; // échantillon borné
  rejectionCounts: Record<RejectionReason, number>;
  journeysGenerated: number; paretoSize: number;
  alternativeSearches: { variant: SearchVariant; status: string; resultCount: number }[];
}

type RejectionReason = "connection_too_short" | "over_budget" | "too_many_transfers"
  | "arrives_too_late" | "departs_too_early" | "excluded_mode" | "dominated"
  | "sold_out" | "beam_pruned";

interface SearchVariant {
  type: "alt_origin_hub" | "alt_destination_hub" | "departure_shift"
      | "budget_relax" | "speed_upgrade" | "cheaper_slower" | "mode_relax" | "next_day";
  modifiedConstraints: SearchParamsPatch;
  reason: string;                 // pourquoi cette variante a été choisie (factuel)
  expectedPotential: number;      // heuristique de sélection
}

interface Alternative {
  variant: SearchVariant;
  journey: Journey;
  deltaPrice: Money; deltaArrivalMinutes: number; deltaDurationMinutes: number;
  alternativeScore: number;
  explanation: string;           // générée par template à partir des deltas
  violatesOriginalConstraints: string[]; // ex. ["over_budget"], affiché clairement
}
```

### 5.4 Base de données (Prisma)

```
User(id, createdAt)                                  -- anonyme en MVP (cookie)
UserPreferences(userId PK, json, updatedAt)
Conversation(id, userId?, createdAt, currentParams Json)
Message(id, conversationId, role, content, createdAt, searchId?)
Search(id, conversationId?, params Json, status, startedAt, completedAt,
       resultJson Json, traceJson Json, containsMock Boolean)
ProviderCallLog(id, searchId, providerId, mode, status, durationMs,
                resultCount, errorCode?, createdAt)   -- observabilité, sans données personnelles
```

Les **hubs** (aéroports, gares, gares routières, ports) sont un **catalogue JSON versionné** chargé en mémoire. Ils changent rarement et doivent être lus en quelques microsecondes. La phase 1 couvre la Côte d'Azur, la Provence, les Baléares, Paris, Barcelone et Lyon. Le catalogue est extensible ensuite depuis OurAirports (domaine public) et les GTFS.

`GET /api/journeys/:id` relit la recherche stockée. Le résultat ré-affiché porte son `checkedAt` d'origine : on ne présente jamais un vieux prix comme frais.

---

## 6. Algorithme multimodal

### 6.1 Comparaison des approches

| Approche | Adaptée ? | Pourquoi |
|---|---|---|
| Dijkstra / A* | ❌ seule | Un seul critère. Ne garde pas B (65 € / 5 h) face à A (50 € / 8 h). |
| **RAPTOR / McRAPTOR** | ✅ pour le transit local | Excellent sur un horaire GTFS complet chargé en mémoire, en multicritère. Mais nos segments longue distance arrivent **à la demande depuis des API**, pas d'un horaire global. |
| CSA | ✅ pour le transit local | Très rapide sur une liste de connexions triée. Même limite que RAPTOR. Multicritère moins naturel. |
| **Recherche par labels multicritère (MLC) sur graphe temporel** | ✅ **cœur du moteur** | Le graphe construit à partir des réponses providers est petit (quelques centaines à milliers d'arêtes). Un label-setting Pareto y est exact, simple et rapide. |

**Choix : architecture à deux niveaux.**

1. **Niveau macro (le nôtre)** : une **recherche par labels Pareto (MLC, Martins généralisé)** sur un graphe temporel construit dynamiquement à partir des segments renvoyés par les providers.
2. **Niveau micro (délégué)** : le transport public local et régional (bus et TER sur GTFS) est résolu par un routeur spécialisé qui implémente déjà RAPTOR (MOTIS / Transitous, Navitia). Il est exposé comme un **provider** qui renvoie des segments ou des sous-trajets. Nous ne réimplémentons pas RAPTOR sur toute l'Europe.

### 6.2 Étapes

**Étape 1 — Résolution et hubs**
- `LocationResolver` : texte → `Place`, via le gazetteer local d'abord, puis Nominatim.
- `reachableHubs(place, maxGroundMinutes)` : filtre le catalogue de hubs par distance à vol d'oiseau, puis estime le temps d'accès (distance × facteur de détour ÷ vitesse du mode). Les hubs sont classés par `importance / temps d'accès`. On garde le top K par type (ex. 3 gares, 3 aéroports, 2 gares routières).
- Les **hubs « de positionnement »** sont plus loin mais importants (Marseille pour Vallauris). Ils sont considérés si `importance` est élevée et que le temps d'accès reste ≤ `maxPositioningMinutes`.
- Même logique côté destination (Palma pour Manacor).

**Étape 2 — Planification des requêtes (`QueryPlanner`)**
- Génère des **patrons de route** : `origine → hubO → hubD → destination`, avec au plus un hub intermédiaire de positionnement (`origine → hubO1 → hubO2 → hubD → destination`).
- Pour chaque patron, il émet des `SegmentQuery` par **tronçon et mode plausible** :
  - accès et sortie : marche, taxi, transit, covoiturage ;
  - tronc : vol seulement entre aéroports distants de plus de 300 km ; train entre gares ; car entre gares routières ; ferry entre ports.
- **Déduplication des requêtes** : la même paire et la même fenêtre ne sont interrogées qu'une fois.
- **Fenêtres temporelles intelligentes** : le tronc est interrogé sur [départ_min + accès_min, latestArrival − sortie_min]. Les accès sont interrogés **après** le tronc, ciblés sur les horaires du tronc (recherche en deux vagues : tronc d'abord, puis accès et sortie).
- **Budget** : `maxProviderCalls` (ex. 40 par recherche). Les requêtes sont classées par priorité (importance du hub × plausibilité du mode).

**Étape 3 — Graphe temporel**
- Nœuds = `Place` (hubs, origine, destination).
- Arêtes horodatées = segments planifiés (vol, train, car, covoiturage à horaire fixe).
- Arêtes flexibles = marche, taxi, voiture (`flexibleDeparture: true`) : on peut partir à tout instant, avec une durée fixe.
- Arêtes de transfert intra-hub (ex. gare de Nice-Ville ↔ aéroport) : générées par le catalogue de hubs (`transfers`), avec durée et mode.

**Étape 4 — Recherche par labels Pareto**

```
Label = { node, arrivalTime, cost, transfers, riskPenalty, prevLabel, viaSegment }

bags[node] = ensemble Pareto de labels (non dominés)
queue = file de priorité ordonnée par arrivalTime
push(Label(origin, earliestDeparture, 0, 0, 0))

tant que queue non vide :
  L = pop()
  si L est dominé dans bags[L.node] : continuer   // dominance paresseuse
  pour chaque arête e sortant de L.node :
    si e planifiée :
       req = ConnectionRules.required(L.viaSegment, e)    // marge minimale
       si e.departure < L.arrivalTime + req : rejeter (connection_too_short)
       t = e.arrival
    sinon (flexible) :
       t = L.arrivalTime + req + e.duration
    L' = Label(e.to, t, L.cost + prix(e), L.transfers + δ, L.risk + risque(e))
    élagages :
      - t > latestArrival                             → arrives_too_late
      - L'.cost > maxBudget × (1 + tolérance alt)     → over_budget
      - L'.transfers > maxTransfers                   → too_many_transfers
      - mode exclu                                    → excluded_mode
      - L' dominé par un label de bags[e.to]          → dominated
      - L' dominé par un label de bags[destination]   → dominated (borne cible)
    insérer L' dans bags[e.to] (en retirant les labels qu'il domine)
    si |bags[e.to]| > beamWidth : garder les meilleurs selon le score BEST → beam_pruned
    push(L')

résultat = bags[destination] → reconstruction des Journey
```

- **Dominance** sur (heure d'arrivée, coût, correspondances). Égalité ou meilleur sur tous les critères et strictement meilleur sur au moins un. Le risque est un **critère secondaire** (départage). Ainsi un trajet plus sûr et plus cher n'est pas éliminé par erreur, mais le front reste petit.
- **Prix inconnu** : coût = 0 pour la dominance, mais le label porte un drapeau `priceUnknown`. Un trajet au prix inconnu **ne peut pas dominer** un trajet au prix connu. C'est un cas de test explicite.
- **Complexité** : avec le budget d'appels et le beam par nœud (ex. 12), la recherche reste en millisecondes.

**Étape 5 — Après la recherche**
- **Fusion** de segments consécutifs du même service (même train sur deux résultats partiels).
- **Déduplication** des Journey identiques venant de providers différents (même opérateur, même numéro, mêmes horaires). On garde la meilleure confiance de prix et on fusionne les liens.
- **Front de Pareto final** sur (prix, durée, correspondances), puis **classement**.

### 6.3 Règles de correspondance (configurables, `config/connection-rules.ts`)

| De → Vers | Marge minimale par défaut |
|---|---|
| train → train | 15 min (10 si même gare et billet unique) |
| bus/car → train | 20 min |
| train → avion | 90 min (75 avec sac à dos, sans bagage en soute) |
| bus/car/covoiturage → avion | 120 min (100 avec sac à dos) |
| avion → * | 30 min de débarquement + 25 min si bagage en soute |
| avion → avion (billets séparés) | 180 min. Correspondance protégée : selon l'aéroport (MCT), hors MVP |
| covoiturage → * | 30 min (horaires de covoiturage moins fiables) |
| * → marche/taxi | 5 min |

Modificateurs :
- `luggage = backpack` réduit les marges aéroport ;
- `separateTickets` ajoute +X % ;
- un changement de terminal ou de gare ajoute le temps de transfert du catalogue ;
- `minimumConnectionBufferMinutes` de l'utilisateur sert de plancher global.

Si la marge est inférieure au minimum, la correspondance est **rejetée**. Si elle est inférieure au minimum + 50 %, le **risque est élevé**. Si elle est inférieure au minimum + 100 %, le **risque est moyen**.

Test critique : train arrivé à 17:30, vol à 18:00, minimum de 90 min → **rejeté** (`connection_too_short`).

### 6.4 Fiabilité

`reliabilityScore = Π (1 − p_miss(connexion))`. `p_miss` est une fonction décroissante de la marge relative (`slack / required`), augmentée par :
- les billets séparés ;
- un changement de terminal ;
- une récupération de bagage ;
- un segment routier (trafic) ;
- un covoiturage ;
- plus tard, l'historique de retards.

Affichage : **Faible / Moyen / Élevé risque**, toujours avec la mention « estimation, pas une garantie ».

### 6.5 Classement

Les profils sont appliqués **sur le front de Pareto** :

- **CHEAPEST** : prix total minimal, puis arrivée la plus tôt. Les prix inconnus passent en dernier.
- **FASTEST** : arrivée la plus tôt (ou durée minimale si la recherche est « départ après »).
- **COMFORT** : correspondances, puis marche, puis risque, puis marge minimale.
- **BEST** : coût généralisé, avec des poids configurables :

```
score = prix
      + valeurDuTemps(€/h) × durée
      + pénalitéCorrespondance × correspondances
      + pénalitéMarche × max(0, marche − tolérance)
      + pénalitéAttente × attente au-delà de 60 min
      + pénalitéRisque × (1 − fiabilité)
```

`valeurDuTemps` vient des préférences ou de la phrase « je paie 20 € de plus pour gagner 2 h » (soit 10 €/h).

Chaque carte porte une **explication calculée** par rapport aux autres profils (templates côté backend) : « 17 € plus cher que l'option la moins chère, mais arrivée 2 h 13 plus tôt. »

---

## 7. Moteur d'alternatives

1. **Recherche principale**, avec des **fenêtres élargies** (−2 h / +2 h) lors des appels providers quand le coût est nul ou faible. Les variantes de décalage horaire réutilisent alors des données **réellement récupérées**, et la trace l'indique.
2. **Génération de variantes candidates** à partir des résultats et de la trace :
   - `alt_origin_hub` / `alt_destination_hub` : hubs atteignables non retenus dans la recherche principale (ex. Marseille, Toulon) ;
   - `departure_shift` : ±30 min, ±1 h, ±2 h, seulement si l'utilisateur n'a pas donné de contrainte dure (« je finis à 15 h » rend « partir plus tôt » invalide) ;
   - `budget_relax` : relancer le **moteur** (sans nouvel appel) avec un budget +25 % ;
   - `speed_upgrade` et `cheaper_slower` : extraits du front de Pareto déjà calculé (sans nouvel appel) ;
   - `mode_relax` : modes non demandés mais non interdits ;
   - `next_day` : seulement si aucun résultat principal ou si les prix sont très élevés.
3. **Score de potentiel** pour chaque variante (heuristique : écart de prix moyen observé sur la paire, importance du hub, etc.). On garde les meilleures, dans la limite de `MAX_ALTERNATIVE_SEARCHES = 6` recherches provider.
4. **Exécution réelle** (cache d'abord), puis passage par le même moteur.
5. **`alternative_score`** : gain significatif seulement. Seuils configurables, par exemple :
   - économie ≥ max(10 €, 15 %) ;
   - ou gain de temps ≥ max(45 min, 15 %) ;
   - ou une correspondance en moins ;
   - ou un risque qui passe d'élevé à faible.

   Le ratio gain/coût est comparé à la valeur du temps de l'utilisateur. 59 € / 6 h 10 face à 60 € / 6 h → **écarté**.
6. On garde **au maximum 3 alternatives**, de types différents. Les **phrases sont générées par template** à partir des deltas calculés. Le LLM peut seulement les reformuler, en recevant les chiffres en entrée et avec une vérification que les nombres de sa sortie correspondent à ceux de l'entrée. Sinon le template brut est utilisé.

---

## 8. Conversation et LLM

- `POST /api/chat` reçoit `{ conversationId?, message }`.
- Le LLM reçoit les `SearchParams` courants, la date et l'heure actuelles avec le fuseau de l'utilisateur, ainsi que le message. Il répond **via un appel d'outil** (tool use / function calling) contenant un `SearchParamsPatch` validé par Zod. Si la validation échoue, une seule nouvelle tentative a lieu, puis on passe au parser déterministe.
- `applyPatch(previous, patch)` est une **fonction pure et testée**. Exemples : « seulement < 70 € » → `maxBudget = 70` ; « enlève les bus » → `addExcludedModes = [bus, coach]` ; « 2 h plus tôt » → `shiftDepartureMinutes = -120`.
- Si une information essentielle manque (ex. pas de destination), le LLM produit `clarificationNeeded` et l'interface pose la question. Aucune recherche n'est lancée.
- La réponse de l'assistant est un **résumé court généré à partir du résultat structuré**. Les cartes et la trace sont rendues par l'interface directement depuis les données, pas depuis le texte du LLM.
- Aucun raisonnement interne n'est exposé. La trace contient seulement des actions factuelles.

---

## 9. API interne

| Endpoint | Rôle |
|---|---|
| `POST /api/chat` | Message → patch → recherche (si complète) → `{ reply, params, result? , clarification? }` |
| `POST /api/search` | Recherche directe avec `SearchParams` structurés (sans LLM) |
| `GET /api/journeys/:id` | Détail d'un itinéraire issu d'une recherche stockée |
| `GET /api/searches/:id/trace` | Trace complète (« Voir toutes les recherches ») |
| `GET /api/providers` | Providers et sources déclarées : statut, modes, mock ou non, intégré ou non |
| `GET /api/health` | Santé : DB, cache, LLM configuré ou non |

Toutes les entrées et sorties sont validées par Zod. Un **rate limiting** par IP (fenêtre glissante, en mémoire ou dans Redis) est appliqué. Les erreurs sont normalisées : `{ error: { code, message } }`, sans fuite de stack.

---

## 10. Interface (mobile-first)

- **Accueil** : un grand champ « Où veux-tu aller ? » avec des suggestions d'exemples.
- **Fil de conversation** : messages, puis bloc de résultats :
  - bandeau **« Données de démonstration — ni prix ni horaires réels »** si `containsMockData` ;
  - **⭐ BEST MATCH** en grande carte (prix, durée, horaires, chaîne de lieux avec icônes de mode, « Pourquoi ») ;
  - **CHEAPEST / FASTEST / COMFORT** en cartes compactes ;
  - **💡 Alternatives intelligentes** (jusqu'à 3), avec deltas et phrase explicative ; le dépassement du budget est clairement signalé ;
  - **🔎 Ce que j'ai recherché** : critère, hubs testés, sources ✓ / ⚠ / ✗, heure de vérification, puis un bouton « Voir toutes les recherches » qui ouvre la trace détaillée.
- **Détail** : timeline verticale avec heure, lieu, mode, opérateur, prix, confiance du prix, attentes et marges, risque par correspondance, lien de réservation par segment, source et `checkedAt` par segment. Totaux en bas.
- **Prix** : formatage `Intl.NumberFormat`. Un total partiellement estimé s'affiche « ≈ 61 € » avec une légende. Un prix inconnu s'affiche « prix non disponible », sans total trompeur.

---

## 11. Observabilité, sécurité, performance, devises

- **Logger structuré** (JSON, `pino`). Événements : `search.started`, `provider.call` (id, mode, durée, statut, nombre de résultats), `provider.error`, `engine.completed` (labels, front, durée), `search.completed`.
  - Pas de texte libre de l'utilisateur dans les logs par défaut. Origine et destination sont tronquées à la ville.
  - Aucune clé n'est loggée. Aucune IP n'est stockée en clair : seulement un hash.
- **Secrets** : uniquement côté serveur (`server-only`), avec `.env.example` et `.env` dans `.gitignore`. Validation des variables d'environnement par Zod au démarrage.
- **Performance** : `Promise.allSettled` avec timeout par provider (`AbortSignal.timeout`). Un provider en panne apparaît en ⚠ dans la trace sans bloquer les autres.
- **Cache** : clé = provider + requête normalisée (paire, fenêtre arrondie, modes, passagers). TTL par provider : vols ~5 min, horaires GTFS ~6 h, géocodage ~30 j. Les résultats servis depuis le cache gardent leur `checkedAt` d'origine et sont marqués `cache_hit` dans la trace.
- **Devises** : `Money` en unités mineures entières. Un `CurrencyConverter` repose sur un `RateSource` (BCE). Pas de taux = pas de conversion : le segment reste dans sa devise d'origine et le total est marqué « devises mixtes ». **EUR par défaut.**

---

## 12. Arborescence proposée

```
travel-agent/
├─ docs/PLAN.md, docs/PROVIDERS.md
├─ docker-compose.yml            # postgres (+ redis optionnel)
├─ .env.example
├─ prisma/schema.prisma
├─ data/hubs/*.json              # catalogue de hubs versionné
├─ src/
│  ├─ app/                       # Next.js (UI + routes API)
│  │  ├─ page.tsx                # accueil conversationnel
│  │  ├─ journeys/[id]/page.tsx  # détail
│  │  └─ api/{chat,search,journeys/[id],searches/[id]/trace,providers,health}/route.ts
│  ├─ components/                # JourneyCard, Timeline, AlternativeCard, SearchTracePanel…
│  ├─ core/                      # ⚠️ TypeScript pur, aucune dépendance Next
│  │  ├─ types/                  # schémas Zod + types inférés
│  │  ├─ time/                   # utilitaires timezone (Luxon)
│  │  ├─ money/                  # Money, somme, conversion
│  │  ├─ location/               # LocationResolver, HubCatalog, reachableHubs, geo
│  │  ├─ providers/
│  │  │  ├─ types.ts, registry.ts, declared-sources.ts
│  │  │  ├─ computed/            # walk, taxi-estimate
│  │  │  ├─ mock/                # mock-flights, mock-trains, mock-coach, mock-rideshare, mock-transit
│  │  │  ├─ flights/             # (phase 3) duffel
│  │  │  ├─ trains/              # (phase 2) sncf-navitia
│  │  │  ├─ transit/             # (phase 2) transitous-motis, google-routes
│  │  │  ├─ buses/ rideshare/ ferries/
│  │  ├─ engine/                 # query-planner, graph, label-search, connection-rules, reliability, dedupe
│  │  ├─ ranking/                # profils, pareto, explications
│  │  ├─ alternatives/           # variantes, scoring, exécution
│  │  ├─ trace/                  # TraceRecorder
│  │  ├─ search/                 # orchestrateur runSearch()
│  │  └─ conversation/           # patch, applyPatch, rule-parser
│  ├─ server/                    # spécifique serveur : llm/, db/, cache/, rate-limit/, logger, env
│  └─ config/                    # connection-rules, ranking-weights, limits
└─ tests/                        # vitest (unit + scénarios)
```

---

## 13. Clés, comptes et démarches nécessaires

| Pour | Quoi | Coût | Phase |
|---|---|---|---|
| LLM | Clé **Anthropic** (`ANTHROPIC_API_KEY`) et/ou OpenAI | À l'usage | 1 (optionnel grâce au parser de secours) |
| Trains (horaires) | Token **API SNCF** (numerique.sncf.com) | Gratuit avec quota | 2 |
| Transit européen | **Transitous** : pas de clé, mais User-Agent avec contact. Prévenir l'équipe en cas d'usage du routage | Gratuit, non commercial | 2 |
| Vols | Compte **Duffel** (token test immédiat, live après vérification) | Test gratuit, live à l'usage | 3 |
| Covoiturage | Demande de clé **BlaBlaCar** Search API | Gratuit (quota) | 4 (démarche à lancer **dès maintenant**) |
| Car (prix) | Partenariat **FlixBus** (affiliation) | — | 3-4 |
| Trains (prix) | Partenariat **Trainline** ou distribution SNCF | Commercial | 3+ |
| Option | **Google Maps Platform** (Routes, Geocoding), avec facturation | À l'usage | Optionnel |
| Option | **Skyscanner** Partners, **Travelpayouts** | Affiliation | Optionnel |
| Infra | PostgreSQL (Docker en local) ; Redis optionnel | — | 1 |

---

## 14. Ce qui peut être construit **maintenant, sans aucune clé**

Tout le cœur, soit environ 80 % de la valeur technique :
- types, schémas Zod, utilitaires temps, fuseaux et monnaie ;
- catalogue de hubs, `reachableHubs`, gazetteer local (dont SKEMA Sophia Antipolis, Vallauris, Manacor…) ;
- moteur multimodal complet, règles de correspondance, fiabilité, Pareto, classement, explications ;
- moteur d'alternatives et `SearchTrace` ;
- providers **mock** déterministes (`is_mock: true`) et providers calculés (marche, taxi estimé) ;
- parser de langage naturel par règles, `applyPatch` et conversation ;
- l'interface complète, l'API, Prisma, le cache mémoire, le rate limiting et les logs ;
- tous les tests demandés.

L'extraction par LLM est branchée dès que `ANTHROPIC_API_KEY` est fournie.

---

## 15. Plan d'implémentation

### Phase 1 — Fondations, moteur, mocks, UI (sans clé)

| Étape | Contenu | Vérification |
|---|---|---|
| 1.1 | Scaffold Next.js + TS strict + Tailwind + Vitest + ESLint ; `docker-compose`, Prisma, `.env.example`, validation de l'environnement | `npm run build`, `npm test` |
| 1.2 | `core/types`, `core/time`, `core/money` | Tests : durées, fuseaux, sommes de prix, devises mixtes |
| 1.3 | Catalogue de hubs (Côte d'Azur, Provence, Baléares, Paris, Lyon, Barcelone), gazetteer, `reachableHubs` | Tests : Vallauris → {Cannes, Antibes, Nice, NCE, …} ; Manacor → PMI |
| 1.4 | Interface provider, registre (allSettled, timeout, cache), sources déclarées, providers mock et calculés | Tests : un provider en panne n'empêche pas les résultats ; statuts de la trace |
| 1.5 | Règles de correspondance, query planner, graphe, recherche par labels, fiabilité, fusion et déduplication | Tests : 17:30 → 18:00 rejeté ; correspondance risquée ; Pareto conserve A/B/C ; budget ; correspondances max ; modes exclus |
| 1.6 | Classement (4 profils) et explications | Tests : cheapest, fastest, best, comfort ; phrases calculées |
| 1.7 | Moteur d'alternatives (budget de 6 recherches, 3 alternatives visibles) | Tests : variante insignifiante écartée ; variante intéressante gardée ; budget respecté |
| 1.8 | Orchestrateur `runSearch` et `TraceRecorder` | Test de scénario : SKEMA → Manacor, 16/10/2026 15:00 Europe/Paris |
| 1.9 | Conversation : parser par règles, `applyPatch`, client LLM (Anthropic et OpenAI) avec tool use | Tests : enchaînement Marseille → Paris / < 70 € / sans bus / 2 h plus tôt |
| 1.10 | Routes API (Zod, rate limit, erreurs) et persistance Prisma | Tests de route |
| 1.11 | UI : accueil, cartes, alternatives, panneau « Ce que j'ai recherché », détail en timeline, bandeau mock | Build et contrôle visuel (Playwright, capture mobile) |
| 1.12 | README complet (installation, commandes, architecture, honnêteté des données) | — |

### Phase 2 — Première vraie source (horaires)

**Transitous / MOTIS** comme `TransitProvider` : TER, Lignes d'Azur, Zou!, FlixBus GTFS, TIB Mallorca. C'est la source la plus riche sans contrat. Ensuite l'**API SNCF** comme `TrainProvider` (temps réel et fourchettes tarifaires). Les prix restent `unknown` ou `range`, et l'interface l'assume.

### Phase 3 — Vols (prix réels), puis trains et cars

Duffel (vols), puis les partenariats Trainline / FlixBus selon les accords obtenus. Géocodage Nominatim. Taux BCE.

### Phase 4 — Covoiturage, transports locaux, ferries

BlaBlaCar (si la clé est obtenue). Google Routes en option. Ferries si une source est trouvée.

### Phase 5 — Optimisation

Auto-hébergement de MOTIS (usage commercial), historique de retards pour la fiabilité, préférences apprises, MCT par aéroport, bagages et frais, péages et carburant, réservation intégrée.

---

## 16. Points à valider

1. **Stack** : une seule application Next.js, cœur métier en TS pur, PostgreSQL + Prisma, Redis optionnel. D'accord ?
2. **LLM par défaut** : Anthropic (Claude), avec OpenAI en alternative et un parser par règles sans clé. D'accord ?
3. **Phase 2** : Transitous (non commercial) pour le prototype, puis MOTIS auto-hébergé si le produit devient commercial. D'accord ?
4. **Langue de l'interface** : français d'abord, avec des textes centralisés pour l'internationalisation plus tard ?
5. **Démarches à lancer en parallèle** (elles ne dépendent pas du code) : clé BlaBlaCar, compte Duffel, token SNCF.
