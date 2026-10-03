/**
 * Analyseur de langage naturel DÉTERMINISTE (français, quelques tournures anglaises).
 * Utilisé sans clé LLM, comme repli si le LLM échoue, et dans les tests.
 * Il ne produit qu'un SearchParamsPatch : jamais d'horaires, de prix ou de trajets.
 */
import { DateTime } from "luxon";
import { MODE_GROUPS, type SearchParams, type SearchParamsPatch, type TransportMode } from "../types";

export interface ParseContext {
  now: Date;
  /** Fuseau de l'utilisateur pour interpréter « demain », « vendredi »… */
  timezone: string;
  previous?: Partial<SearchParams> | null;
}

const WEEKDAYS: Record<string, number> = { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 7 };
const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
};
const NUMBER_WORDS: Record<string, number> = { zero: 0, zéro: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6 };

/** Mots → groupes de modes. */
const MODE_WORDS: [RegExp, TransportMode[]][] = [
  [/\b(avions?|vols?|a[ée]rien)\b/, MODE_GROUPS.flight!],
  [/\b(trains?|tgv|ter|ferroviaire|sncf)\b/, MODE_GROUPS.train!],
  [/\b(bus|cars?|autocars?|flixbus)\b/, MODE_GROUPS.bus!],
  [/\b(covoiturages?|blablacar)\b/, MODE_GROUPS.rideshare!],
  [/\b(taxis?|vtc|uber)\b/, MODE_GROUPS.taxi!],
  [/\b(ferrys?|ferries|bateaux?)\b/, MODE_GROUPS.ferry!],
];

function modesIn(text: string): TransportMode[] {
  const out = new Set<TransportMode>();
  for (const [re, modes] of MODE_WORDS) if (re.test(text)) modes.forEach((m) => out.add(m));
  return [...out];
}

const TIME_RE = String.raw`(\d{1,2})\s*(?:h|:)\s*(\d{2})?|midi|minuit`;

function parseTime(s: string): { h: number; m: number } | null {
  const t = s.trim().toLowerCase();
  if (t === "midi") return { h: 12, m: 0 };
  if (t === "minuit") return { h: 24, m: 0 };
  const m = /(\d{1,2})\s*(?:h|:)\s*(\d{2})?/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 24 || min > 59) return null;
  return { h, m: min };
}

/** Coupe un nom de lieu avant les marqueurs de date/heure/contraintes. */
function stripAccents(s: string): string {
  // NFD puis suppression des diacritiques : même longueur que la chaîne NFC pour l'alphabet latin.
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
}

function cleanPlace(raw: string): string | undefined {
  const stop =
    /(\s*[,.;!?]|\s+(demain|apr[eè]s-demain|aujourd'hui|ce soir|ce matin|cet apr[eè]s-midi|cette nuit|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|le \d|avant|apr[eè]s|vers \d|[àa] \d|[àa] partir|pour|max|maximum|moins|en (avion|train|bus|car|covoiturage)|et (je|j')|je |j'|avec|sans|le plus|d[eè]s|d'ici|au plus|jusqu|seulement|uniquement|\d{1,2}\s*h|\d{1,2}[:/]|le moins|pas de))/i;
  const m = stop.exec(raw);
  const s = (m ? raw.slice(0, m.index) : raw).trim().replace(/^(la |le |l'|les )/i, "").trim();
  return s.length >= 2 ? s : undefined;
}

export function parseMessage(text: string, ctx: ParseContext): SearchParamsPatch {
  const patch: SearchParamsPatch = {};
  // `src` garde les accents (noms de lieux) ; `raw` est la version sans diacritiques, de même longueur,
  // sur laquelle tournent les expressions régulières (\b fonctionne alors correctement).
  const src = text.trim().normalize("NFC");
  const raw = stripAccents(src);
  const low = raw.toLowerCase();
  const fromSrc = (m: RegExpExecArray, group: number) => {
    const idx = m.indices?.[group];
    return idx ? src.slice(idx[0], idx[1]) : m[group]!;
  };
  const now = DateTime.fromJSDate(ctx.now, { zone: ctx.timezone });

  // --- Lieux ---
  let origin: string | undefined;
  let destination: string | undefined;
  const arrow = /^(?:(?:trouve(?:-moi)?|cherche|compare|itin[ée]raire|trajet)\s+(?:(?:un|le|mon)\s+)?(?:trajet\s+)?)?(.+?)\s*(?:→|->|=>|>|\s[-–—]\s)\s*(.+)$/di.exec(raw);
  if (arrow) {
    origin = cleanPlace(fromSrc(arrow, 1).replace(/^(de|depuis)\s+/i, ""));
    destination = cleanPlace(fromSrc(arrow, 2));
  } else {
    const deA = /\b(?:de|depuis)\s+(.+?)\s+(?:[àa]|jusqu'?[àa]|vers|pour)\s+(.+)$/di.exec(raw);
    const fromRe = /\b(?:je suis (?:actuellement )?(?:[àa]|au|aux|en)|je pars (?:de|du|d')|je termine[^.]*?\s[àa]|je finis[^.]*?\s[àa]|d[ée]part (?:de|du|d'))\s*(.+)$/di.exec(raw);
    const toRe = /\b(?:aller|arriver|[êe]tre|rejoindre|me rendre|rentrer|retourner|voyager|direction|vers|destination)\s+(?:[àa]\s+|au\s+|aux\s+|en\s+|jusqu'?[àa]\s+|sur\s+)?(.+)$/di.exec(raw);
    if (fromRe) origin = cleanPlace(fromSrc(fromRe, 1));
    if (toRe) destination = cleanPlace(fromSrc(toRe, 1));
    if (deA && !fromRe && !/\b(moins|plus)\s+de\b/i.test(deA[0].slice(0, 12))) {
      origin = origin ?? cleanPlace(fromSrc(deA, 1));
      destination = destination ?? cleanPlace(fromSrc(deA, 2));
    }
    const followUpFrom = /^(?:et\s+)?(?:depuis|en partant de)\s+(.+?)\s*\??$/di.exec(raw);
    if (followUpFrom) origin = cleanPlace(fromSrc(followUpFrom, 1));
  }
  if (origin) patch.origin = { text: origin };
  if (destination) patch.destination = { text: destination };
  if ((origin && destination) || /nouvelle recherche/i.test(low)) patch.reset = true;

  // --- Date ---
  const prevDate = ctx.previous?.earliestDeparture?.slice(0, 10);
  let date: DateTime | undefined;
  if (/apr[eè]s-demain/.test(low)) date = now.plus({ days: 2 });
  else if (/\bdemain\b/.test(low)) date = now.plus({ days: 1 });
  else if (/aujourd'hui|ce soir|ce matin|cet apr[eè]s-midi|cette nuit/.test(low)) date = now;
  const dm = /\b(\d{1,2})(?:er)?\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)(?:\s+(\d{4}))?/.exec(low);
  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(low);
  if (dm) {
    const month = MONTHS[dm[2]!.normalize("NFD").replace(/[̀-ͯ]/g, "")] ?? MONTHS[dm[2]!]!;
    let year = dm[3] ? Number(dm[3]) : now.year;
    let d = DateTime.fromObject({ year, month, day: Number(dm[1]) }, { zone: ctx.timezone });
    if (!dm[3] && d < now.startOf("day")) d = d.plus({ years: 1 });
    year = d.year;
    date = d;
  } else if (slash) {
    let year = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : now.year;
    let d = DateTime.fromObject({ year, month: Number(slash[2]), day: Number(slash[1]) }, { zone: ctx.timezone });
    if (!slash[3] && d < now.startOf("day")) d = d.plus({ years: 1 });
    year = d.year;
    if (d.isValid) date = d;
  } else {
    const wd = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/.exec(low);
    if (wd && !date) {
      const target = WEEKDAYS[wd[1]!]!;
      let diff = (target - now.weekday + 7) % 7;
      if (/prochain/.test(low) && diff === 0) diff = 7;
      date = now.plus({ days: diff });
    }
  }

  // --- Heures ---
  const latestM = new RegExp(String.raw`\b(?:avant|au plus tard [àa]?|d'ici|arriv[ée]e? (?:max(?:imum)?|avant)|pas après)\s*(${TIME_RE})`, "i").exec(low);
  const earliestM = new RegExp(
    String.raw`\b(?:apr[eè]s|[àa] partir de|d[eè]s|d[ée]part (?:[àa]|vers)?|partir (?:[àa]|vers)|termine[^.]*?[àa]|finis[^.]*?[àa]|sors[^.]*?[àa]|[àa]|vers)\s*(${TIME_RE})`,
    "i",
  ).exec(low.replace(latestM?.[0] ?? "\u0000", " "));
  const baseDate = (date ?? (prevDate ? DateTime.fromISO(prevDate, { zone: ctx.timezone }) : now)).startOf("day");
  let earliest: DateTime | undefined;
  if (earliestM) {
    const tm = parseTime(earliestM[1]!);
    if (tm) earliest = baseDate.plus({ hours: tm.h, minutes: tm.m });
  } else if (date) {
    earliest = /ce soir/.test(low) ? baseDate.plus({ hours: 18 }) : date.hasSame(now, "day") ? now : baseDate.plus({ hours: 6 });
  }
  if (earliest) {
    patch.earliestDeparture = earliest.toFormat("yyyy-LL-dd'T'HH:mm");
    if (/\b(termine|finis|sors|je suis|pas avant|apr[eè]s|[àa] partir de|d[eè]s)\b/.test(low)) patch.departureFlexibility = "hard";
  }
  if (latestM) {
    const tm = parseTime(latestM[1]!);
    if (tm) {
      let l = (earliest ?? baseDate).startOf("day").plus({ hours: tm.h, minutes: tm.m });
      if (earliest && l <= earliest) l = l.plus({ days: 1 });
      patch.latestArrival = l.toFormat("yyyy-LL-dd'T'HH:mm");
    }
  }

  // --- Budget ---
  const budget =
    /(?:moins de|max(?:imum)?|<|sous|pas plus de|jusqu'?[àa]|inf[ée]rieur [àa])\s*(\d+(?:[.,]\d+)?)\s*(?:€|euros?|eur)(?![a-z])/i.exec(raw) ??
    /budget\s*(?:de|max(?:imum)?|:)?\s*(\d+(?:[.,]\d+)?)/i.exec(raw);
  if (budget && !/correspondance/.test(budget[0])) patch.maxBudget = Number(budget[1]!.replace(",", "."));
  if (/(sans|pas de) (limite de )?budget|peu importe le prix/.test(low)) patch.clearMaxBudget = true;

  // --- Objectif ---
  if (/moins cher|pas cher|[ée]conomique|cheapest|meilleur prix/.test(low)) patch.objective = "cheapest";
  else if (/plus rapide|plus vite|le plus t[ôo]t|au plus vite|fastest|arriver t[ôo]t/.test(low)) patch.objective = "fastest";
  else if (/confort|moins de correspondances|le plus simple/.test(low)) patch.objective = "comfort";
  else if (/meilleur compromis|meilleur rapport/.test(low)) patch.objective = "best";

  // --- Modes ---
  const exclusion = /\b(?:pas d[e']|sans|enl[eè]ve(?:-moi)?|retire|[ée]vite|exclu[se]?|aucun|no)\s+(?:les?\s+|la\s+|l'|de\s+)?([a-zé\s,'et]+)/gi;
  const excluded = new Set<TransportMode>();
  for (const m of raw.matchAll(exclusion)) {
    const seg = m[1]!.split(/\b(?:je|pour|max|moins|avant|apr[eè]s)\b/i)[0]!.toLowerCase();
    if (/correspondance|budget|limite/.test(seg)) continue;
    modesIn(seg).forEach((x) => excluded.add(x));
  }
  if (excluded.size) patch.addExcludedModes = [...excluded];
  const readd = /\b(?:remets?|rajoute|ajoute|r[ée]int[eè]gre)\s+(?:les?\s+|la\s+|l')?([a-zé\s,'et]+)/i.exec(raw);
  if (readd) {
    const modes = modesIn(readd[1]!.toLowerCase());
    if (modes.length) patch.removeExcludedModes = modes;
  }
  const only = /\b(?:seulement|uniquement|que)\s+(?:en\s+|le\s+|les\s+|l'|par\s+)?([a-zé\s,'et]+)/i.exec(raw);
  const compare = /\bcompare\s+([a-zé\s,'et]+)/i.exec(raw);
  const onlyModes = only ? modesIn(only[1]!.toLowerCase().split(/\b(?:je|pour|max|moins|avant|apr[eè]s)\b/)[0]!) : [];
  if (onlyModes.length) patch.includedModes = onlyModes;
  else if (compare) {
    const cm = modesIn(compare[1]!.toLowerCase());
    if (cm.length >= 2) patch.includedModes = cm;
  }
  if (/tous (les )?modes|n'importe quel (mode|transport)/.test(low)) patch.clearIncludedModes = true;

  // --- Correspondances ---
  const tr = /(?:max(?:imum)?|au plus|pas plus de)\s+(\d|z[ée]ro|une?|deux|trois|quatre)\s+correspondances?|(\d|z[ée]ro|une?|deux|trois|quatre)\s+correspondances?\s+max(?:imum)?/i.exec(low);
  if (tr) {
    const w = (tr[1] ?? tr[2])!;
    patch.maxTransfers = /^\d$/.test(w) ? Number(w) : NUMBER_WORDS[w] ?? NUMBER_WORDS[w.normalize("NFD").replace(/[̀-ͯ]/g, "")]!;
  } else if (/\b(direct|sans correspondance)\b/.test(low)) patch.maxTransfers = 0;

  // --- Bagages ---
  if (/sac [àa] dos|backpack|juste un sac/.test(low)) patch.luggage = "backpack";
  else if (/soute|bagage enregistr[ée]|grosse valise/.test(low)) patch.luggage = "checked";
  else if (/bagage cabine|valise cabine/.test(low)) patch.luggage = "cabin";

  // --- Valeur du temps : « 20 € de plus si ça me fait gagner au moins 2 heures » ---
  const vot = /(\d+(?:[.,]\d+)?)\s*(?:€|euros?)\s+de plus[^.]*?gagner[^.\d]*?(\d+(?:[.,]\d+)?|une?|deux|trois|quatre)\s*(h|heures?|min(?:utes?)?)/i.exec(low);
  if (vot) {
    const amount = Number(vot[1]!.replace(",", "."));
    const n = /^\d/.test(vot[2]!) ? Number(vot[2]!.replace(",", ".")) : NUMBER_WORDS[vot[2]!]!;
    const hours = /^min/.test(vot[3]!) ? n / 60 : n;
    if (hours > 0) patch.valueOfTimePerHour = Math.round((amount / hours) * 100) / 100;
  }

  // --- Décalage : « je peux partir deux heures plus tôt » ---
  const shift = /partir\s+(\d+|une?|deux|trois|quatre|une demi)[- ]?(?:(h|heures?)|(min(?:utes?)?))\s*(?:(\d{2}))?\s*plus\s+(t[ôo]t|tard)/i.exec(low);
  if (shift) {
    const n = shift[1] === "une demi" ? 0.5 : /^\d/.test(shift[1]!) ? Number(shift[1]) : NUMBER_WORDS[shift[1]!]!;
    let minutes = shift[2] ? n * 60 + (shift[4] ? Number(shift[4]) : 0) : n;
    if (/t[ôo]t/.test(shift[5]!)) minutes = -minutes;
    patch.shiftDepartureMinutes = Math.round(minutes);
    delete patch.earliestDeparture;
  }

  // --- Marge de correspondance ---
  const buf = /au moins\s+(\d+)\s*min(?:utes?)?\s+(?:de\s+)?(?:marge|correspondance)/i.exec(low);
  if (buf) patch.minConnectionBufferMinutes = Number(buf[1]);

  return patch;
}
