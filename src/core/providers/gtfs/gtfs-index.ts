/**
 * Index GTFS compact en mémoire (tableaux typés) pour répondre à « quels services relient
 * un arrêt proche de A à un arrêt proche de B, au départ dans une fenêtre donnée ? ».
 * Ne charge pas shapes.txt. Respecte pickup_type / drop_off_type (montée / descente interdite).
 */

export interface GtfsStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** stop_timezone si fourni (affichage), sinon fuseau de l'agence. */
  tz?: string;
  url?: string;
}

export interface GtfsRoute {
  id: string;
  shortName: string;
  longName: string;
  type: number;
  agencyId: string;
  url?: string;
}

export interface GtfsService {
  /** Bits 0..6 = lundi..dimanche. */
  weekdays: number;
  start: number;
  end: number;
  added: Set<number>;
  removed: Set<number>;
}

export interface GtfsIndex {
  agencyTimezone: string;
  agencies: Map<string, { name: string; url?: string; timezone: string }>;
  stops: GtfsStop[];
  routes: GtfsRoute[];
  tripRoute: Int32Array;
  tripService: Int32Array;
  tripIds: string[];
  tripHeadsign: string[];
  tripShortName: string[];
  /** stop_times triés par voyage puis séquence ; tripStart[t]..tripStart[t+1]. */
  tripStart: Int32Array;
  stStop: Int32Array;
  stArr: Int32Array;
  stDep: Int32Array;
  /** bit 1 : montée interdite ; bit 2 : descente interdite. */
  stFlags: Uint8Array;
  stTrip: Int32Array;
  /** Occurrences par arrêt (indices de stop_times) : occStart[s]..occStart[s+1]. */
  occStart: Int32Array;
  occ: Int32Array;
  services: GtfsService[];
  /** Grille spatiale ~1,1 km (0,01°) → indices d'arrêts. */
  grid: Map<string, number[]>;
  validity: { start: number; end: number };
  feedInfo: Record<string, string>;
}

/** Lecture CSV tolérante (guillemets RFC 4180), renvoie l'en-tête et un itérateur de lignes. */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? "").map((h) => h.trim());
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    let line = lines[i]!;
    if (!line) continue;
    // Champ entre guillemets contenant un saut de ligne : on recolle.
    while (countQuotes(line) % 2 === 1 && i + 1 < lines.length) line += "\n" + lines[++i];
    rows.push(splitCsvLine(line));
  }
  return { header, rows };
}

function countQuotes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 34) n++;
  return n;
}

export function splitCsvLine(line: string): string[] {
  if (line.indexOf('"') === -1) return line.split(",");
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function col(header: string[], name: string): number {
  return header.indexOf(name);
}

export function parseGtfsTime(s: string | undefined): number {
  if (!s) return -1;
  const m = /^\s*(\d{1,3}):(\d{2}):(\d{2})\s*$/.exec(s);
  if (!m) return -1;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

const cellKey = (lat: number, lon: number) => `${Math.floor(lat * 100)}:${Math.floor(lon * 100)}`;

/**
 * Construit l'index à partir des fichiers texte d'un flux GTFS.
 * `files` : nom de fichier → contenu (agency, stops, routes, trips, stop_times, calendar, calendar_dates, feed_info).
 */
export function buildGtfsIndex(files: Map<string, string>): GtfsIndex {
  const need = (n: string) => {
    const f = files.get(n);
    if (f === undefined) throw new Error(`GTFS : fichier manquant ${n}`);
    return parseCsv(f);
  };

  // Agences
  const agencies = new Map<string, { name: string; url?: string; timezone: string }>();
  const ag = need("agency.txt");
  for (const r of ag.rows) {
    const id = r[col(ag.header, "agency_id")] ?? "";
    agencies.set(id, { name: r[col(ag.header, "agency_name")] ?? "", url: r[col(ag.header, "agency_url")] || undefined, timezone: r[col(ag.header, "agency_timezone")] ?? "UTC" });
  }
  const agencyTimezone = [...agencies.values()][0]?.timezone ?? "UTC";

  // Arrêts
  const st = need("stops.txt");
  const stops: GtfsStop[] = [];
  const stopIdx = new Map<string, number>();
  const [sId, sName, sLat, sLon, sTz, sUrl, sLoc] = ["stop_id", "stop_name", "stop_lat", "stop_lon", "stop_timezone", "stop_url", "location_type"].map((n) => col(st.header, n));
  for (const r of st.rows) {
    const loc = sLoc! >= 0 ? r[sLoc!] : "";
    if (loc && loc !== "0") continue; // stations parentes, entrées… : seuls les points d'arrêt servent au routage
    const lat = Number(r[sLat!]);
    const lon = Number(r[sLon!]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    stopIdx.set(r[sId!]!, stops.length);
    stops.push({ id: r[sId!]!, name: (r[sName!] ?? "").trim(), lat, lon, tz: (sTz! >= 0 && r[sTz!]) || undefined, url: (sUrl! >= 0 && r[sUrl!]) || undefined });
  }
  const grid = new Map<string, number[]>();
  stops.forEach((s, i) => {
    const k = cellKey(s.lat, s.lon);
    const l = grid.get(k);
    if (l) l.push(i);
    else grid.set(k, [i]);
  });

  // Lignes
  const rt = need("routes.txt");
  const routes: GtfsRoute[] = [];
  const routeIdx = new Map<string, number>();
  const firstAgency = [...agencies.keys()][0] ?? "";
  for (const r of rt.rows) {
    routeIdx.set(r[col(rt.header, "route_id")]!, routes.length);
    routes.push({
      id: r[col(rt.header, "route_id")]!,
      shortName: r[col(rt.header, "route_short_name")] ?? "",
      longName: r[col(rt.header, "route_long_name")] ?? "",
      type: Number(r[col(rt.header, "route_type")] ?? 3),
      agencyId: (col(rt.header, "agency_id") >= 0 && r[col(rt.header, "agency_id")]) || firstAgency,
      url: (col(rt.header, "route_url") >= 0 && r[col(rt.header, "route_url")]) || undefined,
    });
  }

  // Services
  const services: GtfsService[] = [];
  const serviceIdx = new Map<string, number>();
  const svc = (id: string) => {
    let i = serviceIdx.get(id);
    if (i === undefined) {
      i = services.length;
      serviceIdx.set(id, i);
      services.push({ weekdays: 0, start: 99999999, end: 0, added: new Set(), removed: new Set() });
    }
    return services[i]!;
  };
  let vStart = 99999999;
  let vEnd = 0;
  if (files.has("calendar.txt")) {
    const c = parseCsv(files.get("calendar.txt")!);
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => col(c.header, d));
    for (const r of c.rows) {
      const s = svc(r[col(c.header, "service_id")]!);
      s.weekdays = days.reduce((m, ci, b) => (r[ci] === "1" ? m | (1 << b) : m), 0);
      s.start = Number(r[col(c.header, "start_date")]);
      s.end = Number(r[col(c.header, "end_date")]);
      vStart = Math.min(vStart, s.start);
      vEnd = Math.max(vEnd, s.end);
    }
  }
  if (files.has("calendar_dates.txt")) {
    const c = parseCsv(files.get("calendar_dates.txt")!);
    const [ci, di, ei] = ["service_id", "date", "exception_type"].map((n) => col(c.header, n));
    for (const r of c.rows) {
      const s = svc(r[ci!]!);
      const d = Number(r[di!]);
      if (r[ei!] === "1") {
        s.added.add(d);
        vStart = Math.min(vStart, d);
        vEnd = Math.max(vEnd, d);
      } else s.removed.add(d);
    }
  }

  // Voyages
  const tr = need("trips.txt");
  const [tRoute, tSvc, tId, tHead, tShort] = ["route_id", "service_id", "trip_id", "trip_headsign", "trip_short_name"].map((n) => col(tr.header, n));
  const tripIdx = new Map<string, number>();
  const tripRouteArr: number[] = [];
  const tripSvcArr: number[] = [];
  const tripIds: string[] = [];
  const tripHeadsign: string[] = [];
  const tripShortName: string[] = [];
  for (const r of tr.rows) {
    const ri = routeIdx.get(r[tRoute!]!);
    if (ri === undefined) continue;
    tripIdx.set(r[tId!]!, tripIds.length);
    tripIds.push(r[tId!]!);
    tripRouteArr.push(ri);
    svc(r[tSvc!]!);
    tripSvcArr.push(serviceIdx.get(r[tSvc!]!)!);
    tripHeadsign.push(tHead! >= 0 ? (r[tHead!] ?? "") : "");
    tripShortName.push(tShort! >= 0 ? (r[tShort!] ?? "") : "");
  }

  // Horaires (le plus gros fichier : découpage manuel ligne à ligne)
  const stText = files.get("stop_times.txt");
  if (stText === undefined) throw new Error("GTFS : fichier manquant stop_times.txt");
  const stLines = (stText.charCodeAt(0) === 0xfeff ? stText.slice(1) : stText).split(/\r?\n/);
  const h = splitCsvLine(stLines[0]!).map((x) => x.trim());
  const [cTrip, cArr, cDep, cStop, cSeq, cPick, cDrop] = ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "pickup_type", "drop_off_type"].map((n) => col(h, n));
  const rowsTrip: number[] = [];
  const rowsSeq: number[] = [];
  const rowsStop: number[] = [];
  const rowsArr: number[] = [];
  const rowsDep: number[] = [];
  const rowsFlags: number[] = [];
  for (let i = 1; i < stLines.length; i++) {
    const line = stLines[i]!;
    if (!line) continue;
    const r = splitCsvLine(line);
    const t = tripIdx.get(r[cTrip!]!);
    const s = stopIdx.get(r[cStop!]!);
    if (t === undefined || s === undefined) continue;
    const arr = parseGtfsTime(r[cArr!]);
    const dep = parseGtfsTime(r[cDep!]);
    rowsTrip.push(t);
    rowsSeq.push(Number(r[cSeq!]));
    rowsStop.push(s);
    rowsArr.push(arr >= 0 ? arr : dep);
    rowsDep.push(dep >= 0 ? dep : arr);
    rowsFlags.push((cPick! >= 0 && r[cPick!] === "1" ? 1 : 0) | (cDrop! >= 0 && r[cDrop!] === "1" ? 2 : 0));
  }
  const n = rowsTrip.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => rowsTrip[a]! - rowsTrip[b]! || rowsSeq[a]! - rowsSeq[b]!);
  const stStop = new Int32Array(n);
  const stArr = new Int32Array(n);
  const stDep = new Int32Array(n);
  const stFlags = new Uint8Array(n);
  const stTrip = new Int32Array(n);
  order.forEach((o, i) => {
    stStop[i] = rowsStop[o]!;
    stArr[i] = rowsArr[o]!;
    stDep[i] = rowsDep[o]!;
    stFlags[i] = rowsFlags[o]!;
    stTrip[i] = rowsTrip[o]!;
  });
  const nTrips = tripIds.length;
  const tripStart = new Int32Array(nTrips + 1);
  for (let i = 0; i < n; i++) tripStart[stTrip[i]! + 1]!++;
  for (let t = 0; t < nTrips; t++) tripStart[t + 1]! += tripStart[t]!;

  const occStart = new Int32Array(stops.length + 1);
  for (let i = 0; i < n; i++) occStart[stStop[i]! + 1]!++;
  for (let s = 0; s < stops.length; s++) occStart[s + 1]! += occStart[s]!;
  const fill = occStart.slice(0, stops.length);
  const occ = new Int32Array(n);
  for (let i = 0; i < n; i++) occ[fill[stStop[i]!]!++] = i;

  const feedInfo: Record<string, string> = {};
  if (files.has("feed_info.txt")) {
    const f = parseCsv(files.get("feed_info.txt")!);
    f.header.forEach((k, i) => (feedInfo[k] = f.rows[0]?.[i] ?? ""));
    // La période annoncée par l'éditeur restreint la période calculée depuis les calendriers.
    if (/^\d{8}$/.test(feedInfo.feed_start_date ?? "")) vStart = Math.max(vStart, Number(feedInfo.feed_start_date));
    if (/^\d{8}$/.test(feedInfo.feed_end_date ?? "")) vEnd = Math.min(vEnd, Number(feedInfo.feed_end_date));
  }

  return {
    agencyTimezone,
    agencies,
    stops,
    routes,
    tripRoute: Int32Array.from(tripRouteArr),
    tripService: Int32Array.from(tripSvcArr),
    tripIds,
    tripHeadsign,
    tripShortName,
    tripStart,
    stStop,
    stArr,
    stDep,
    stFlags,
    stTrip,
    occStart,
    occ,
    services,
    grid,
    validity: { start: vStart, end: vEnd },
    feedInfo,
  };
}

/** Le service circule-t-il à cette date (YYYYMMDD) de ce jour de semaine (1 = lundi … 7 = dimanche) ? */
export function serviceActive(s: GtfsService, ymd: number, isoWeekday: number): boolean {
  if (s.removed.has(ymd)) return false;
  if (s.added.has(ymd)) return true;
  return ymd >= s.start && ymd <= s.end && (s.weekdays & (1 << (isoWeekday - 1))) !== 0;
}

/** Arrêts à moins de `radiusKm` d'un point, du plus proche au plus lointain (au plus `limit`). */
export function stopsNear(idx: GtfsIndex, lat: number, lon: number, radiusKm: number, limit = 10): { stop: number; km: number }[] {
  const cells = Math.ceil(radiusKm / 1.1) + 1;
  const la = Math.floor(lat * 100);
  const lo = Math.floor(lon * 100);
  const out: { stop: number; km: number }[] = [];
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (let i = -cells; i <= cells; i++) {
    for (let j = -cells; j <= cells; j++) {
      for (const s of idx.grid.get(`${la + i}:${lo + j}`) ?? []) {
        const st = idx.stops[s]!;
        const dy = (st.lat - lat) * 111.32;
        const dx = (st.lon - lon) * 111.32 * cosLat;
        const km = Math.sqrt(dx * dx + dy * dy);
        if (km <= radiusKm) out.push({ stop: s, km });
      }
    }
  }
  return out.sort((a, b) => a.km - b.km).slice(0, limit);
}
