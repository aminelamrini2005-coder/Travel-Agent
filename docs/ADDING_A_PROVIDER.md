# Ajouter une source de transport

Le moteur (graphe temporel, classement, alternatives, trace) ne dépend d'aucune source précise.
Brancher une nouvelle plateforme se fait en **trois fichiers**, sans toucher au cœur.

## 1. L'adapter (`src/core/providers/<famille>/<source>.ts`)

Implémenter `TransportProvider` (`src/core/providers/types.ts`) :

| Champ | Rôle |
|---|---|
| `id`, `displayName`, `attribution` | Identité et mention de source affichées dans la trace |
| `accessMethod` | `API`, `OPEN_DATA`, `BROWSER`, `COMPUTED` ou `MOCK` |
| `isMock` | `true` si les données sont fictives (ex. jeton de test Duffel) |
| `modes` | Modes produits |
| `cacheTtlSeconds`, `timeoutMs`, `maxCallsPerSearch`, `maxConcurrency` | Coût, quotas, latence |
| `availability()` | Désactivé (avec une raison i18n) si la clé est absente |
| `supports(query)` | Couverture, sans appel réseau |
| `search(query, ctx)` | Renvoie des `TransportSegment` normalisés |

Règles :
- **Ne jamais inventer un prix** : `price: null` et `priceConfidence: "UNKNOWN"` si la source ne le donne pas. `RANGE` pour un tarif de référence, `ESTIMATED` seulement pour une méthode de calcul documentée.
- Horaires en **UTC** ; fuseau IANA dans `origin.timezone` / `destination.timezone`.
- `checkedAt` = instant de l'appel ; `dataAsOf` = fraîcheur de la donnée source.
- Lever `ProviderBlockedError` sur un 429, un CAPTCHA ou un anti-bot : **aucune nouvelle tentative**.
- `bookingUrl` uniquement si c'est un lien officiel réel ; sinon `null`.

Le registre valide chaque segment (Zod), force la provenance (`provider`, `accessMethod`, `isMock`), convertit les devises avec les taux BCE (jamais de taux inventé) et met en cache.

## 2. L'intégration (`src/server/integrations.ts`)

Ajouter une entrée `Integration` (variables d'environnement requises, statut). Les emplacements sont déjà prévus pour BlaBlaCar, Google Routes, Skyscanner, Trainline, FlixBus (API partenaire) et les ferries.

## 3. Les tests (`tests/adapters.test.ts`)

Tester la conversion sur une **réponse d'exemple** (fixture) : heures, fuseaux, prix, modes, cas « prix absent », et l'arrêt sur HTTP 429.

## Données de démonstration

Avec `MOCK_POLICY=fallback`, un provider fictif n'est interrogé sur une paire que pour les familles de modes (air, rail, route, covoiturage, mer) où **aucune source réelle n'a renvoyé de résultat**. Chaque trajet porte une couverture `dataQuality` calculée par le backend, et l'interface badge chaque segment DONNÉE RÉELLE, DÉMO ou ESTIMATION.
