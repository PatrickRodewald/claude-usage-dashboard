/**
 * Aufschluesselungen und der komplette Dashboard-Snapshot, den die API liefert.
 */

import {
  newTotals,
  addTokens,
  totalTokens,
  weightedTokens,
  cacheHitRate,
} from './pricing.js';
import { dayKey, getZonedParts, lastNDayKeys, startOfDay } from './tz.js';
import { projectNameFrom } from './parser.js';
import {
  buildSessionBlocks,
  activeBlock,
  currentWeekWindow,
  weekWindowsFor,
  burnRate,
  projectLimitHit,
  warnLevel,
  HOUR_MS,
} from './windows.js';
import { projectFromUtilization, planFromTier, PLAN_LABEL } from './liveUsage.js';

/** Gruppiert Eintraege und rechnet Tokens + Kosten je Gruppe zusammen. */
export function rollup(entries, keyFn, pricing) {
  const map = new Map();
  for (const e of entries) {
    const key = keyFn(e);
    if (key == null) continue;
    let b = map.get(key);
    if (!b) {
      b = {
        key,
        tokens: newTotals(),
        cost: 0,
        costKnown: true,
        count: 0,
        firstTs: e.ts,
        lastTs: e.ts,
        models: new Set(),
        projects: new Set(),
      };
      map.set(key, b);
    }
    addTokens(b.tokens, e);
    b.count++;
    if (e.ts < b.firstTs) b.firstTs = e.ts;
    if (e.ts > b.lastTs) b.lastTs = e.ts;
    b.models.add(e.model);
    if (e.project) b.projects.add(e.project);

    const { cost, known } = pricing.costFor(e, e.model, { speed: e.speed, timestampMs: e.ts });
    b.cost += cost;
    if (!known) b.costKnown = false;
  }
  return map;
}

/**
 * Lesbaren Anzeigenamen je Projekt bestimmen.
 *
 * Gruppiert wird nach Transkript-Ordner (stabil). Fuer die Anzeige gewinnt das
 * FLACHSTE beobachtete cwd - waehrend einer Sitzung wechselt Claude Code in
 * Unterverzeichnisse, und deren Namen ("src", "server", "components") sind als
 * Projektname wertlos.
 */
export function projectLabels(entries) {
  const best = new Map();
  for (const e of entries) {
    if (!e.project) continue;
    const cwd = typeof e.cwd === 'string' && e.cwd.trim() ? e.cwd : null;
    const depth = cwd ? cwd.split(/[\\/]/).filter(Boolean).length : Infinity;
    const prev = best.get(e.project);
    if (!prev || depth < prev.depth) best.set(e.project, { cwd, depth });
  }
  const labels = new Map();
  for (const [key, val] of best) {
    labels.set(key, projectNameFrom(val.cwd, key));
  }
  return labels;
}

function bucketToPlain(b, weights) {
  return {
    key: b.key,
    tokens: b.tokens,
    total: totalTokens(b.tokens),
    weighted: weightedTokens(b.tokens, weights),
    cost: b.cost,
    costKnown: b.costKnown,
    count: b.count,
    firstTs: b.firstTs,
    lastTs: b.lastTs,
    models: [...b.models].sort(),
    projects: [...b.projects].sort(),
  };
}

function sumEntries(entries, pricing) {
  const tokens = newTotals();
  let cost = 0;
  let costKnown = true;
  for (const e of entries) {
    addTokens(tokens, e);
    const r = pricing.costFor(e, e.model, { speed: e.speed, timestampMs: e.ts });
    cost += r.cost;
    if (!r.known) costKnown = false;
  }
  return { tokens, cost, costKnown, count: entries.length };
}

/**
 * Limit fuer ein Fenster bestimmen.
 *
 * 'auto' kalibriert gegen das hoechste jemals gemessene abgeschlossene
 * Fenster - ehrlicher als geratene Absolutwerte, solange Anthropic die
 * echten Budgets nicht veroeffentlicht. Reichen die historischen Daten nicht
 * (autoMinSamples), wird auf die Plan-Schaetzung zurueckgefallen.
 */
export function resolveLimit({ mode, planLimit, history, minSamples = 3 }) {
  if (mode === 'auto') {
    const usable = history.filter((v) => v > 0);
    if (usable.length >= minSamples) {
      return { limit: Math.max(...usable), source: 'auto', samples: usable.length };
    }
    // Bewusst KEIN Rueckfall auf den geratenen Planwert: der liegt in echten
    // Daten leicht um den Faktor 3 daneben und wuerde eine erfundene
    // Prozentzahl als "kritisch" anzeigen. Lieber ehrlich "kalibriert noch".
    return { limit: null, source: 'calibrating', samples: usable.length, minSamples };
  }
  if (Number.isFinite(planLimit) && planLimit > 0) {
    return { limit: planLimit, source: 'plan', samples: 0 };
  }
  return { limit: null, source: 'unknown', samples: 0 };
}

function windowView({ label, start, end, tokens, cost, costKnown, count, limitInfo, weights, now, warnings, lastActivity }) {
  const weighted = weightedTokens(tokens, weights);
  const limit = limitInfo.limit;
  const percent = limit ? (weighted / limit) * 100 : null;
  const rate = burnRate(tokens, start, now, weights);
  const projection = projectLimitHit({
    used: weighted,
    limit,
    ratePerMinute: rate,
    nowMs: now,
    windowEndMs: end,
  });
  return {
    label,
    start,
    end,
    lastActivity: lastActivity ?? null,
    msUntilReset: Math.max(0, end - now),
    tokens,
    total: totalTokens(tokens),
    weighted,
    cost,
    costKnown,
    count,
    limit,
    limitSource: limitInfo.source,
    limitSamples: limitInfo.samples,
    limitMinSamples: limitInfo.minSamples ?? null,
    percent,
    level: percent == null ? 'unknown' : warnLevel(percent, warnings),
    burnRatePerMin: rate,
    projection,
  };
}

/**
 * Vollstaendiger Snapshot fuer das Dashboard.
 *
 * @param entries deduplizierte, normalisierte Eintraege
 */
export function buildSnapshot(
  entries,
  { config, pricing, now = Date.now(), scan = {}, liveUsage = null } = {},
) {
  const tz = config.timezone ?? 'Europe/Berlin';
  const weights = config.counting?.weights ?? {};
  const warnings = config.warnings ?? {};
  const blockHours = config.window?.fiveHourBlockHours ?? 5;
  const anchorToFullHour = config.window?.anchorToFullHour !== false;
  // Tarif vorrangig aus dem Account ableiten, nicht aus der config.json. Das
  // funktioniert auch offline, weil rateLimitTier lokal in .credentials.json
  // steht - so stimmt die Anzeige auch auf einem fremden Geraet.
  const detectedPlan = planFromTier(liveUsage?.rateLimitTier, liveUsage?.subscriptionType);
  const planKey = detectedPlan ?? config.plan ?? 'max5x';
  const planSource = detectedPlan ? 'account' : 'config';
  const planLimits = config.limits?.plans?.[planKey] ?? {};
  const limitMode = config.limits?.mode ?? 'auto';
  const minSamples = config.limits?.autoMinSamples ?? 3;

  /**
   * Fensteransicht aus den ECHTEN Anthropic-Daten.
   *
   * Prozentwert und Reset-Zeit kommen von der API, sind also autoritativ. Der
   * Fensterstart ergibt sich aus reset minus Fensterlaenge - damit lassen sich
   * die lokalen Transkripte auf exakt dasselbe Fenster summieren und liefern
   * Tokens und Kosten, die die API nicht kennt.
   */
  const apiWindowView = (label, win, windowMs) => {
    const inWindow = entries.filter((e) => e.ts >= win.start && e.ts < win.end);
    const sum = sumEntries(inWindow, pricing);
    const proj = projectFromUtilization(win, now);
    return {
      label,
      source: 'anthropic',
      start: win.start,
      end: win.end,
      msUntilReset: Math.max(0, win.end - now),
      lastActivity: inWindow.length ? Math.max(...inWindow.map((e) => e.ts)) : null,
      percent: win.percent,
      level: warnLevel(win.percent, warnings),
      apiSeverity: win.severity,
      isActive: win.isActive ?? null,
      ...sum,
      total: totalTokens(sum.tokens),
      weighted: weightedTokens(sum.tokens, weights),
      limit: null,
      limitSource: 'anthropic',
      limitSamples: 0,
      limitMinSamples: null,
      burnRatePerMin: burnRate(sum.tokens, win.start, now, weights),
      burnPercentPerMin: proj?.percentPerMinute ?? null,
      projection: proj,
      idle: false,
    };
  };

  const live = liveUsage?.ok ? liveUsage : null;

  // --- 5-Stunden-Fenster -------------------------------------------------
  const blocks = buildSessionBlocks(entries, { blockHours, anchorToFullHour });
  const active = activeBlock(blocks, now, { blockHours });
  const closedBlocks = blocks.filter((b) => b !== active);
  const fiveHourLimit = resolveLimit({
    mode: limitMode,
    planLimit: planLimits.fiveHourTokens,
    history: closedBlocks.map((b) => weightedTokens(b.tokens, weights)),
    minSamples,
  });

  const activeEntries = active
    ? entries.filter((e) => e.ts >= active.start && e.ts < active.end)
    : [];
  const activeSum = sumEntries(activeEntries, pricing);
  const fiveHourStart = active ? active.start : now;
  const fiveHourEnd = active ? active.end : now + blockHours * HOUR_MS;

  const fiveHour = live?.fiveHour
    ? apiWindowView('5h-Fenster', live.fiveHour, blockHours * HOUR_MS)
    : (() => {
        const v = windowView({
          label: `${blockHours}h-Fenster`,
          start: fiveHourStart,
          end: fiveHourEnd,
          lastActivity: active ? active.lastActivity : null,
          ...activeSum,
          limitInfo: fiveHourLimit,
          weights,
          now,
          warnings,
        });
        v.source = 'estimate';
        v.idle = !active;
        return v;
      })();

  // --- Wochenfenster -----------------------------------------------------
  const weekCfg = config.week ?? {};
  const { start: weekStart, end: weekEnd } = currentWeekWindow(now, tz, weekCfg);
  const allWeeks = weekWindowsFor(entries, tz, weekCfg, now);
  const closedWeeks = allWeeks.filter((w) => w.start !== weekStart);
  const weekLimit = resolveLimit({
    mode: limitMode,
    planLimit: planLimits.weeklyTokens,
    history: closedWeeks.map((w) => weightedTokens(w.tokens, weights)),
    minSamples,
  });
  const weekEntries = entries.filter((e) => e.ts >= weekStart && e.ts < weekEnd);
  const weekSum = sumEntries(weekEntries, pricing);
  const week = live?.week
    ? apiWindowView('Woche', live.week, 7 * 24 * HOUR_MS)
    : (() => {
        const v = windowView({
          label: 'Woche',
          start: weekStart,
          end: weekEnd,
          lastActivity: weekEntries.length ? Math.max(...weekEntries.map((e) => e.ts)) : null,
          ...weekSum,
          limitInfo: weekLimit,
          weights,
          now,
          warnings,
        });
        v.source = 'estimate';
        return v;
      })();

  // --- Heute + Tagesverlauf ---------------------------------------------
  const todayKey = dayKey(now, tz);
  const todayEntries = entries.filter((e) => dayKey(e.ts, tz) === todayKey);
  const todaySum = sumEntries(todayEntries, pricing);
  const dayStart = startOfDay(now, tz);

  const hourBuckets = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    tokens: newTotals(),
    cost: 0,
    count: 0,
  }));
  for (const e of todayEntries) {
    const h = getZonedParts(e.ts, tz).hour;
    const b = hourBuckets[h];
    if (!b) continue;
    addTokens(b.tokens, e);
    b.count++;
    b.cost += pricing.costFor(e, e.model, { speed: e.speed, timestampMs: e.ts }).cost;
  }
  const currentHour = getZonedParts(now, tz).hour;
  const byHour = hourBuckets.map((b) => ({
    hour: b.hour,
    weighted: weightedTokens(b.tokens, weights),
    total: totalTokens(b.tokens),
    cost: b.cost,
    count: b.count,
    future: b.hour > currentHour,
  }));

  // --- Tageszeitreihe (30 Tage) -----------------------------------------
  const dayRoll = rollup(entries, (e) => dayKey(e.ts, tz), pricing);
  const daily = lastNDayKeys(now, tz, 30).map((key) => {
    const b = dayRoll.get(key);
    return b
      ? {
          day: key,
          weighted: weightedTokens(b.tokens, weights),
          total: totalTokens(b.tokens),
          tokens: b.tokens,
          cost: b.cost,
          costKnown: b.costKnown,
          count: b.count,
        }
      : {
          day: key,
          weighted: 0,
          total: 0,
          tokens: newTotals(),
          cost: 0,
          costKnown: true,
          count: 0,
        };
  });

  // --- Aufschluesselungen ------------------------------------------------
  const sortByCostThenTokens = (a, b) => b.cost - a.cost || b.total - a.total;
  const labels = projectLabels(entries);
  const label = (key) => labels.get(key) ?? key;

  const byProject = [...rollup(entries, (e) => e.project, pricing).values()]
    .map((b) => ({ ...bucketToPlain(b, weights), key: label(b.key), id: b.key }))
    .sort(sortByCostThenTokens);

  const byModel = [...rollup(entries, (e) => e.model, pricing).values()]
    .map((b) => ({
      ...bucketToPlain(b, weights),
      priced: pricing.resolveName(b.key) != null,
    }))
    .sort(sortByCostThenTokens);

  const bySession = [...rollup(entries, (e) => e.sessionId, pricing).values()]
    .map((b) => {
      const plain = bucketToPlain(b, weights);
      return { ...plain, projects: plain.projects.map(label) };
    })
    .sort((a, b) => b.lastTs - a.lastTs)
    .slice(0, 50);

  // --- Gesamt + Cache ----------------------------------------------------
  const allTokens = newTotals();
  let allCost = 0;
  let allCostKnown = true;
  for (const b of dayRoll.values()) {
    addTokens(allTokens, b.tokens);
    allCost += b.cost;
    if (!b.costKnown) allCostKnown = false;
  }

  const unknownModels = byModel.filter((m) => !m.priced).map((m) => m.key);

  return {
    generatedAt: now,
    timezone: tz,
    locale: config.locale ?? 'de-DE',
    plan: planKey,
    planLabel: PLAN_LABEL[planKey] ?? planKey,
    planSource,
    rateLimitTier: liveUsage?.rateLimitTier ?? null,
    warnings: { warnPercent: warnings.warnPercent ?? 70, criticalPercent: warnings.criticalPercent ?? 90 },
    countingWeights: {
      input: weights.input ?? 1,
      output: weights.output ?? 1,
      cacheWrite: weights.cacheWrite ?? 1,
      cacheRead: weights.cacheRead ?? 0,
    },
    scan,
    live: {
      // 'anthropic' = echte Werte aus dem Abo, 'estimate' = lokale Schaetzung.
      source: live ? 'anthropic' : 'estimate',
      available: Boolean(live),
      reason: liveUsage?.ok ? null : (liveUsage?.reason ?? 'disabled'),
      fetchedAt: liveUsage?.fetchedAt ?? null,
      subscriptionType: live?.subscriptionType ?? null,
      rateLimitTier: live?.rateLimitTier ?? null,
      scoped: live?.scoped ?? [],
      extraUsage: live?.extraUsage ?? null,
      spend: live?.spend ?? null,
      fiveHour,
      week,
    },
    today: {
      day: todayKey,
      dayStart,
      ...todaySum,
      total: totalTokens(todaySum.tokens),
      weighted: weightedTokens(todaySum.tokens, weights),
      byHour,
    },
    daily,
    byProject,
    byModel,
    bySession,
    totals: {
      tokens: allTokens,
      total: totalTokens(allTokens),
      weighted: weightedTokens(allTokens, weights),
      cost: allCost,
      costKnown: allCostKnown,
      requests: entries.length,
      blocks: blocks.length,
    },
    cache: {
      hitRate: cacheHitRate(allTokens),
      read: allTokens.cacheRead,
      write5m: allTokens.cacheWrite5m,
      write1h: allTokens.cacheWrite1h,
    },
    unknownModels,
  };
}
