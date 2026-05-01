"use strict";

const throttleTime = 150;
const reports = {};
const wclUserGraphqlUrl = "https://www.warcraftlogs.com/api/v2/user";
let summaryGenerationToken = 0;

let nextRequestTime = 0;
const metricsSignatureVersion = "sig-v2";

function getStorageLayer() {
    if (typeof window !== "undefined" && window.weaveDelayStorage) {
        return window.weaveDelayStorage;
    }
    return null;
}

function getNumericInputValue(inputId, fallbackValue) {
    const el = document.getElementById(inputId);
    const value = Number(el ? el.value : fallbackValue);
    if (!Number.isFinite(value)) {
        return fallbackValue;
    }
    return value;
}

function getParameterByName(name, url = window.location.href) {
    name = name.replace(/[\[\]]/g, '\\$&');
    var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function printError(e) {
    const message = e && e.message ? e.message : e;
    console.log(message);
    alert("Error:\n" + message + "\n\nRefresh the page to start again.");
}

function sleep(ms) {
    return new Promise(f => setTimeout(f, ms));
}

function calculateMedian(values) {
    if (!values || values.length === 0) {
        return 0;
    }
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

function getMetricsConfigSignature() {
    const instants = localStorage.getItem("instants") === "true" ? "1" : "0";
    const outliers = String(getNumericInputValue("outliers", 0) || 0);
    const y12 = String(getNumericInputValue("y12", 0) || 0);
    const y3 = String(getNumericInputValue("y3", 0) || 0);
    const ignoreShortest = String(Math.max(0, Math.floor(getNumericInputValue("ignore_shortest", 0))));
    const ignoreLongest = String(Math.max(0, Math.floor(getNumericInputValue("ignore_longest", 0))));
    const deathCutoff = String(Math.max(0, Math.floor(getNumericInputValue("death_cutoff", 0))));
    return [metricsSignatureVersion, instants, outliers, y12, y3, ignoreShortest, ignoreLongest, deathCutoff].join("|");
}

function formatDurationMs(durationMs) {
    const totalSeconds = Math.max(0, Math.floor(Number(durationMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return String(hours) + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
    }
    return String(minutes) + ":" + String(seconds).padStart(2, "0");
}

async function fetchWCLUserGraphql(query, variables = {}) {
    console.log("fetching data from WCL v2...");
    let t = (new Date).getTime();
    nextRequestTime = Math.max(nextRequestTime, t);
    let d = nextRequestTime - t;
    nextRequestTime += throttleTime;
    await sleep(d);

    if (typeof ensureAuthAccessToken !== "function") {
        throw new Error("OAuth module failed to load. Refresh the page and try again.");
    }

    async function run(accessToken) {
        return fetch(wclUserGraphqlUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`
            },
            body: JSON.stringify({ query: query, variables: variables })
        });
    }

    let accessToken = await ensureAuthAccessToken();
    let response = await run(accessToken);

    if (response.status === 401 && typeof refreshAuthAccessToken === "function") {
        const refreshedToken = await refreshAuthAccessToken();
        if (refreshedToken) {
            response = await run(refreshedToken);
        }
    }

    if (response.status === 401 || response.status === 403) {
        if (typeof disconnectWarcraftLogs === "function") {
            disconnectWarcraftLogs();
        }
        throw new Error("Warcraft Logs authorization failed. Reconnect Warcraft Logs in Settings.");
    }
    if (!response.ok) {
        throw new Error("Fetch error (" + response.status + ").");
    }

    const payload = await response.json();
    if (payload.errors && payload.errors.length) {
        throw new Error("Warcraft Logs API error: " + payload.errors[0].message);
    }
    return payload.data;
}

function normalizeEvent(rawEvent, abilityByGameId = {}) {
    if (!rawEvent) {
        return null;
    }
    const timestamp = Number(rawEvent.timestamp);
    const abilityName = rawEvent.ability && rawEvent.ability.name
        ? rawEvent.ability.name
        : rawEvent.abilityName
            ? rawEvent.abilityName
            : (function () {
                const abilityId = Number(
                    rawEvent.abilityGameID ||
                    (rawEvent.ability && rawEvent.ability.gameID) ||
                    (typeof rawEvent.ability === "number" ? rawEvent.ability : NaN)
                );
                if (!Number.isFinite(abilityId)) {
                    return "";
                }
                return abilityByGameId[abilityId] || ("Ability " + abilityId);
            })();
    if (!Number.isFinite(timestamp) || !abilityName) {
        return null;
    }
    const canonicalAbilityName = normalizeAbilityName(abilityName);
    const sourceId = Number(
        rawEvent.sourceID ??
        rawEvent.sourceId ??
        (rawEvent.source && rawEvent.source.id) ??
        Number.NaN
    );
    return {
        timestamp: timestamp,
        sourceID: Number.isFinite(sourceId) ? sourceId : null,
        ability: {
            name: canonicalAbilityName
        }
    };
}

function normalizeAbilityName(name) {
    if (!name) {
        return name;
    }
    const trimmed = String(name).trim();
    const meleeAliases = new Set([
        "Attack",
        "Auto Attack",
        "Main Hand",
        "Off Hand",
        "Melee Swing",
        "Melee (Main Hand)",
        "Melee (Off Hand)"
    ]);
    if (meleeAliases.has(trimmed)) {
        return "Melee";
    }
    if (/^Ability\s+(1|6603)$/i.test(trimmed)) {
        // 6603 is the common WoW auto-attack/melee swing spell id.
        return "Melee";
    }
    return trimmed;
}

async function fetchReportMeta(reportCode) {
    const data = await fetchWCLUserGraphql(`
query ReportMeta($code: String!) {
  reportData {
    report(code: $code) {
      fights {
        id
        name
        startTime
        endTime
        encounterID
      }
      masterData {
        actors {
          id
          name
          type
          subType
        }
        abilities {
          gameID
          name
        }
      }
    }
  }
}`, { code: reportCode });

    const report = data && data.reportData ? data.reportData.report : null;
    if (!report) {
        throw new Error("Could not load report metadata.");
    }

    const fights = (report.fights || []).map(fight => ({
        id: fight.id,
        name: fight.name,
        start_time: fight.startTime,
        end_time: fight.endTime,
        boss: fight.encounterID || 0
    }));

    const actors = report.masterData && report.masterData.actors ? report.masterData.actors : [];

    const abilityByGameId = {};
    const abilities = report.masterData && report.masterData.abilities ? report.masterData.abilities : [];
    for (const ability of abilities) {
        if (ability && Number.isFinite(Number(ability.gameID)) && ability.name) {
            abilityByGameId[Number(ability.gameID)] = ability.name;
        }
    }

    return {
        fights: fights,
        actors: actors,
        abilityByGameId: abilityByGameId
    };
}

async function fetchFightCasts(reportCode, fightId, sourceId, startTime, endTime, abilityByGameId = {}) {
    let allEvents = [];
    let pageStart = startTime;

    while (true) {
        const data = await fetchWCLUserGraphql(`
query ReportCasts($code: String!, $fightIDs: [Int!], $sourceID: Int, $startTime: Float, $endTime: Float, $viewOptions: Int) {
  reportData {
    report(code: $code) {
      events(dataType: Casts, fightIDs: $fightIDs, sourceID: $sourceID, startTime: $startTime, endTime: $endTime, viewOptions: $viewOptions, translate: true) {
        data
        nextPageTimestamp
      }
    }
  }
}`, {
            code: reportCode,
            fightIDs: [Number(fightId)],
            sourceID: sourceId === null || sourceId === undefined ? null : Number(sourceId),
            startTime: Number(pageStart),
            endTime: Number(endTime),
            viewOptions: 66
        });

        const eventsPayload = data && data.reportData && data.reportData.report
            ? data.reportData.report.events
            : null;
        if (!eventsPayload) {
            throw new Error("Could not load cast events.");
        }

        const rawEvents = eventsPayload.data || [];
        const pageEvents = rawEvents
            .map(event => normalizeEvent(event, abilityByGameId))
            .filter(Boolean);
        if (rawEvents.length > 0 && pageEvents.length === 0) {
            console.log("WCL raw event shape (first event):", rawEvents[0]);
        }
        allEvents = allEvents.concat(pageEvents);

        if (!eventsPayload.nextPageTimestamp || eventsPayload.nextPageTimestamp >= endTime) {
            break;
        }
        pageStart = eventsPayload.nextPageTimestamp;
    }

    return {
        events: allEvents
    };
}

function normalizeDeathEvent(rawEvent) {
    if (!rawEvent) {
        return null;
    }
    const timestamp = Number(rawEvent.timestamp);
    if (!Number.isFinite(timestamp)) {
        return null;
    }
    const targetId = Number(
        rawEvent.targetID ??
        rawEvent.targetId ??
        (rawEvent.target && rawEvent.target.id) ??
        Number.NaN
    );
    const targetName = rawEvent.target && rawEvent.target.name
        ? rawEvent.target.name
        : (rawEvent.targetName ? String(rawEvent.targetName) : "");
    return {
        timestamp: timestamp,
        targetId: Number.isFinite(targetId) ? targetId : null,
        targetName: targetName
    };
}

async function fetchFightDeaths(reportCode, fightId, startTime, endTime) {
    let allDeaths = [];
    let pageStart = startTime;

    while (true) {
        const data = await fetchWCLUserGraphql(`
query ReportDeaths($code: String!, $fightIDs: [Int!], $startTime: Float, $endTime: Float, $viewOptions: Int) {
  reportData {
    report(code: $code) {
      events(dataType: Deaths, fightIDs: $fightIDs, startTime: $startTime, endTime: $endTime, viewOptions: $viewOptions, translate: true) {
        data
        nextPageTimestamp
      }
    }
  }
}`, {
            code: reportCode,
            fightIDs: [Number(fightId)],
            startTime: Number(pageStart),
            endTime: Number(endTime),
            viewOptions: 66
        });

        const eventsPayload = data && data.reportData && data.reportData.report
            ? data.reportData.report.events
            : null;
        if (!eventsPayload) {
            throw new Error("Could not load death events.");
        }

        const rawEvents = eventsPayload.data || [];
        const pageEvents = rawEvents
            .map(event => normalizeDeathEvent(event))
            .filter(Boolean);
        allDeaths = allDeaths.concat(pageEvents);

        if (!eventsPayload.nextPageTimestamp || eventsPayload.nextPageTimestamp >= endTime) {
            break;
        }
        pageStart = eventsPayload.nextPageTimestamp;
    }

    allDeaths.sort((a, b) => a.timestamp - b.timestamp);
    return { deaths: allDeaths };
}

class Report {
    constructor(reportId, withTrash) {
        this.reportId = reportId;
        this.withTrash = withTrash;
        this.fightHunterCasts = {};
        this.fightHunterMetrics = {};
        this.fightAllCasts = {};
        this.summaryCache = {};
        this.storage = getStorageLayer();
    }

    async fetchData() {
        if ("data" in this) {
            return;
        }
        let cachedReport = null;
        if (this.storage) {
            try {
                cachedReport = await this.storage.getReport(this.reportId);
            } catch (e) {
                console.warn("IndexedDB report read failed:", e);
            }
        }
        if (cachedReport && cachedReport.fightsMeta && cachedReport.actorsMeta && cachedReport.abilitiesMeta) {
            this.data = {
                fights: cachedReport.fightsMeta,
                actors: cachedReport.actorsMeta,
                abilityByGameId: cachedReport.abilitiesMeta
            };
        } else {
            this.data = await fetchReportMeta(this.reportId);
            if (this.storage) {
                this.storage.putReport({
                    reportCode: this.reportId,
                    title: "",
                    owner: "",
                    startTime: null,
                    endTime: null,
                    fightsMeta: this.data.fights || [],
                    actorsMeta: this.data.actors || [],
                    abilitiesMeta: this.data.abilityByGameId || {},
                    fetchedAt: Date.now()
                }).catch(e => console.warn("IndexedDB report write failed:", e));
            }
        }
        this.abilityByGameId = this.data.abilityByGameId || {};
        this.actors = this.data.actors || [];
        this.players = this.actors.filter(actor => actor && actor.type === "Player");
    }

    isHunterActor(actor) {
        const classText = actor && actor.subType ? String(actor.subType).toLowerCase() : "";
        return classText.includes("hunter");
    }

    getHunters() {
        return this.players.filter(actor => this.isHunterActor(actor));
    }

    async getFightHunterCasts(fight, hunter) {
        const fightKey = String(fight.id);
        const hunterKey = String(hunter.id);
        if (!this.fightHunterCasts[fightKey]) {
            this.fightHunterCasts[fightKey] = {};
        }
        if (this.fightHunterCasts[fightKey][hunterKey]) {
            return this.fightHunterCasts[fightKey][hunterKey];
        }

        if (this.storage) {
            try {
                const cachedHunterEvents = await this.storage.getHunterEvents(this.reportId, fight.id, hunter.id);
                if (cachedHunterEvents && Array.isArray(cachedHunterEvents.castsNormalized)) {
                    const allFightCastsForDeaths = await this.getFightAllCasts(fight);
                    const cachedResult = {
                        events: cachedHunterEvents.castsNormalized,
                        deaths: allFightCastsForDeaths.deaths || []
                    };
                    this.fightHunterCasts[fightKey][hunterKey] = cachedResult;
                    return cachedResult;
                }
            } catch (e) {
                console.warn("IndexedDB hunter events read failed:", e);
            }
        }

        const allFightCasts = await this.getFightAllCasts(fight);
        const filteredEvents = (allFightCasts.events || []).filter(event => event.sourceID === Number(hunter.id));
        const deaths = allFightCasts.deaths || [];
        let result = { events: filteredEvents, deaths: deaths };
        // Fallback for schemas that don't include source ID in event rows.
        if (filteredEvents.length === 0 && (allFightCasts.events || []).some(event => event.sourceID === null)) {
            const sourcedCasts = await fetchFightCasts(
                this.reportId,
                fight.id,
                hunter.id,
                fight.start_time,
                fight.end_time,
                this.abilityByGameId
            );
            result = { events: sourcedCasts.events || [], deaths: deaths };
        }

        this.fightHunterCasts[fightKey][hunterKey] = result;
        if (this.storage) {
            this.storage.putHunterEvents({
                id: this.storage.getHunterKey(this.reportId, fight.id, hunter.id),
                reportCode: this.reportId,
                fightId: String(fight.id),
                hunterId: String(hunter.id),
                castsNormalized: result.events || [],
                derivedFromFightEvents: true,
                computedAt: Date.now()
            }).catch(e => console.warn("IndexedDB hunter events write failed:", e));
        }
        return result;
    }

    async getFightAllCasts(fight) {
        const fightKey = String(fight.id);
        if (this.fightAllCasts[fightKey]) {
            return this.fightAllCasts[fightKey];
        }
        if (this.storage) {
            try {
                const cachedFightEvents = await this.storage.getFightEvents(this.reportId, fight.id);
                if (cachedFightEvents && Array.isArray(cachedFightEvents.castsNormalized)) {
                    const cachedResult = {
                        events: cachedFightEvents.castsNormalized,
                        deaths: Array.isArray(cachedFightEvents.deaths) ? cachedFightEvents.deaths : []
                    };
                    this.fightAllCasts[fightKey] = cachedResult;
                    return cachedResult;
                }
            } catch (e) {
                console.warn("IndexedDB fight events read failed:", e);
            }
        }

        const [castsResult, deathsResult] = await Promise.all([
            fetchFightCasts(
                this.reportId,
                fight.id,
                null,
                fight.start_time,
                fight.end_time,
                this.abilityByGameId
            ),
            fetchFightDeaths(
                this.reportId,
                fight.id,
                fight.start_time,
                fight.end_time
            )
        ]);
        const result = {
            events: castsResult.events || [],
            deaths: deathsResult.deaths || []
        };
        this.fightAllCasts[fightKey] = result;
        if (this.storage) {
            this.storage.putFightEvents({
                id: this.storage.getFightKey(this.reportId, fight.id),
                reportCode: this.reportId,
                fightId: String(fight.id),
                startTime: fight.start_time,
                endTime: fight.end_time,
                castsNormalized: result.events || [],
                deaths: result.deaths || [],
                source: "wcl",
                fetchedAt: Date.now()
            }).catch(e => console.warn("IndexedDB fight events write failed:", e));
        }
        return result;
    }

    async getCachedFightHunterMetrics(fight, hunter, signature) {
        const fightKey = String(fight.id);
        const hunterKey = String(hunter.id);
        if (this.fightHunterMetrics[fightKey] && this.fightHunterMetrics[fightKey][hunterKey]) {
            const memoryValue = this.fightHunterMetrics[fightKey][hunterKey][signature];
            if (memoryValue !== undefined) {
                return memoryValue;
            }
        }
        if (!this.storage) {
            return null;
        }
        try {
            const cached = await this.storage.getMetricsSnapshot(this.reportId, fight.id, hunter.id, signature);
            if (!cached || !cached.metrics) {
                return null;
            }
            this.setCachedFightHunterMetricsInMemory(fight, hunter, signature, cached.metrics);
            return cached.metrics;
        } catch (e) {
            console.warn("IndexedDB metrics read failed:", e);
            return null;
        }
    }

    setCachedFightHunterMetricsInMemory(fight, hunter, signature, metrics) {
        const fightKey = String(fight.id);
        const hunterKey = String(hunter.id);
        if (!this.fightHunterMetrics[fightKey]) {
            this.fightHunterMetrics[fightKey] = {};
        }
        if (!this.fightHunterMetrics[fightKey][hunterKey]) {
            this.fightHunterMetrics[fightKey][hunterKey] = {};
        }
        this.fightHunterMetrics[fightKey][hunterKey][signature] = metrics;
    }

    async setCachedFightHunterMetrics(fight, hunter, signature, metrics) {
        this.setCachedFightHunterMetricsInMemory(fight, hunter, signature, metrics);
        if (!this.storage || !metrics) {
            return;
        }
        this.storage.putMetricsSnapshot({
            id: this.storage.getMetricsKey(this.reportId, fight.id, hunter.id, signature),
            reportCode: this.reportId,
            fightId: String(fight.id),
            hunterId: String(hunter.id),
            metricsSignatureV2: signature,
            knobs: {
                instants: localStorage.getItem("instants") === "true",
                outliersMs: getNumericInputValue("outliers", 0),
                y12: getNumericInputValue("y12", 2500),
                y3: getNumericInputValue("y3", 4000),
                ignoreShortestX: Math.max(0, Math.floor(getNumericInputValue("ignore_shortest", 0))),
                ignoreLongestX: Math.max(0, Math.floor(getNumericInputValue("ignore_longest", 0))),
                deathCutoffCount: Math.max(0, Math.floor(getNumericInputValue("death_cutoff", 0)))
            },
            metrics: metrics,
            computedAt: Date.now()
        }).catch(e => console.warn("IndexedDB metrics write failed:", e));
    }

    buildMetricsFromEvents(events, startTime, deaths) {
        let mutable_casts = events
            .filter(cast => cast && cast.ability && cast.ability.name && Number.isFinite(cast.timestamp))
            .slice()
            .sort((a, b) => a.timestamp - b.timestamp);

        if (mutable_casts.length === 0) {
            return null;
        }

        const instantsEnabled = localStorage.getItem("instants") === "true";
        const outlierThreshold = getNumericInputValue("outliers", 0) || 0;
        const y12 = getNumericInputValue("y12", 2500) || 2500;
        const y3 = getNumericInputValue("y3", 4000) || 4000;
        const ignoreShortestX = Math.max(0, Math.floor(getNumericInputValue("ignore_shortest", 0)));
        const ignoreLongestX = Math.max(0, Math.floor(getNumericInputValue("ignore_longest", 0)));
        const deathCutoffCount = Math.max(0, Math.floor(getNumericInputValue("death_cutoff", 0)));

        if (deathCutoffCount > 0 && Array.isArray(deaths) && deaths.length > 0) {
            const sortedDeaths = deaths
                .filter(death => death && Number.isFinite(Number(death.timestamp)))
                .slice()
                .sort((a, b) => a.timestamp - b.timestamp);
            if (sortedDeaths.length >= deathCutoffCount) {
                const cutoffTimestamp = Number(sortedDeaths[deathCutoffCount - 1].timestamp);
                mutable_casts = mutable_casts.filter(cast => cast.timestamp <= cutoffTimestamp);
            }
        }

        if (mutable_casts.length === 0) {
            return null;
        }

        const meleeSet = new Set(["Melee", "Raptor Strike"]);
        const whitelistSet = instantsEnabled
            ? new Set(["Arcane Shot", "Auto Shot", "Steady Shot", "Scorpid Sting", "Serpent Sting", "Multi-Shot", "Raptor Strike", "Melee"])
            : new Set(["Auto Shot", "Steady Shot", "Multi-Shot", "Raptor Strike", "Melee"]);
        const filteredCasts = [];
        for (const cast of mutable_casts) {
            if (!whitelistSet.has(cast.ability.name)) {
                continue;
            }
            if (cast.ability.name === "Melee" && filteredCasts.length > 0) {
                const previousAbilityName = filteredCasts[filteredCasts.length - 1].ability.name;
                if (meleeSet.has(previousAbilityName)) {
                    filteredCasts.pop();
                }
            }
            filteredCasts.push(cast);
        }
        mutable_casts = filteredCasts;

        if (mutable_casts.length === 0) {
            return null;
        }

        let timestamps_weave = [];
        let ability_weave_time = [];
        let weave_ability_time = [];

        for (let i = 0; i < mutable_casts.length; i++) {
            let cast = mutable_casts[i];
            if ((cast.ability.name == "Melee" || cast.ability.name == "Raptor Strike") && i >= 1 && i < mutable_casts.length - 1) {
                timestamps_weave.push((cast.timestamp - startTime) / 1000);
                ability_weave_time.push(cast.timestamp - mutable_casts[i - 1].timestamp);
                weave_ability_time.push(mutable_casts[i + 1].timestamp - cast.timestamp);
            }
        }

        let total_weave_time = [];
        const filteredTimestamps = [];
        const filteredAbilityToWeave = [];
        const filteredWeaveToAbility = [];
        for (let i = 0; i < ability_weave_time.length; i++) {
            const total = ability_weave_time[i] + weave_ability_time[i];
            if (outlierThreshold > 0 && total > outlierThreshold) {
                continue;
            }
            filteredTimestamps.push(timestamps_weave[i]);
            filteredAbilityToWeave.push(ability_weave_time[i]);
            filteredWeaveToAbility.push(weave_ability_time[i]);
            total_weave_time.push(total);
        }
        timestamps_weave = filteredTimestamps;
        ability_weave_time = filteredAbilityToWeave;
        weave_ability_time = filteredWeaveToAbility;

        const trimCount = ignoreShortestX + ignoreLongestX;
        if (trimCount > 0 && total_weave_time.length > 0) {
            const rankedIndices = total_weave_time
                .map((value, idx) => ({ idx: idx, value: value }))
                .sort((a, b) => {
                    if (a.value === b.value) {
                        return a.idx - b.idx;
                    }
                    return a.value - b.value;
                });
            const removeIndices = new Set();
            const shortestToDrop = Math.min(ignoreShortestX, rankedIndices.length);
            for (let i = 0; i < shortestToDrop; i++) {
                removeIndices.add(rankedIndices[i].idx);
            }
            let longestToDrop = Math.min(ignoreLongestX, rankedIndices.length - removeIndices.size);
            for (let i = rankedIndices.length - 1; i >= 0 && longestToDrop > 0; i--) {
                const idx = rankedIndices[i].idx;
                if (!removeIndices.has(idx)) {
                    removeIndices.add(idx);
                    longestToDrop -= 1;
                }
            }

            const keptTimestamps = [];
            const keptAbilityToWeave = [];
            const keptWeaveToAbility = [];
            const keptTotal = [];
            for (let i = 0; i < total_weave_time.length; i++) {
                if (removeIndices.has(i)) {
                    continue;
                }
                keptTimestamps.push(timestamps_weave[i]);
                keptAbilityToWeave.push(ability_weave_time[i]);
                keptWeaveToAbility.push(weave_ability_time[i]);
                keptTotal.push(total_weave_time[i]);
            }

            timestamps_weave = keptTimestamps;
            ability_weave_time = keptAbilityToWeave;
            weave_ability_time = keptWeaveToAbility;
            total_weave_time = keptTotal;
        }

        let average1 = (ability_weave_time.reduce((a, b) => a + b, 0) / ability_weave_time.length) || 0;
        let average2 = (weave_ability_time.reduce((a, b) => a + b, 0) / ability_weave_time.length) || 0;
        let average3 = (total_weave_time.reduce((a, b) => a + b, 0) / ability_weave_time.length) || 0;
        let median1 = calculateMedian(ability_weave_time);
        let median2 = calculateMedian(weave_ability_time);
        let median3 = calculateMedian(total_weave_time);

        const zip1 = [];
        const zip2 = [];
        const zip3 = [];
        for (let i = 0; i < timestamps_weave.length; i++) {
            const val1 = ability_weave_time[i];
            const val2 = weave_ability_time[i];
            const val3 = total_weave_time[i];
            if (val1 > y12 || val2 > y12 || val3 > y3) {
                continue;
            }
            zip1.push([timestamps_weave[i], val1]);
            zip2.push([timestamps_weave[i], val2]);
            zip3.push([timestamps_weave[i], val3]);
        }

        const lastCast = mutable_casts[mutable_casts.length - 1];
        if (!lastCast || !Number.isFinite(lastCast.timestamp)) {
            return null;
        }
        let x_limit = (lastCast.timestamp - startTime) / 1000 + 10;

        return {
            zip1: zip1,
            zip2: zip2,
            zip3: zip3,
            totalWeaveValues: total_weave_time.slice(),
            average1: average1,
            average2: average2,
            average3: average3,
            median1: median1,
            median2: median2,
            median3: median3,
            x_limit: x_limit,
            y12: y12,
            y3: y3
        };
    }

    async buildAllPullsSummary() {
        const trashEnabled = document.getElementById("trash_enabled").checked;
        const metricsSignature = getMetricsConfigSignature();
        const summaryCacheKey = String(trashEnabled) + "|" + metricsSignature;
        if (this.summaryCache[summaryCacheKey]) {
            return this.summaryCache[summaryCacheKey];
        }
        if (this.storage) {
            try {
                const cachedSummary = await this.storage.getEncounterSummary(this.reportId, summaryCacheKey);
                if (cachedSummary && Array.isArray(cachedSummary.encounterGroups)) {
                    this.summaryCache[summaryCacheKey] = cachedSummary.encounterGroups;
                    return cachedSummary.encounterGroups;
                }
            } catch (e) {
                console.warn("IndexedDB summary read failed:", e);
            }
        }
        const eligibleFights = this.data.fights.filter(fight => trashEnabled || fight.boss != 0);
        const hunters = this.getHunters();
        const encounterMap = {};

        for (const fight of eligibleFights) {
            const encounterId = Number(fight.boss || 0);
            const key = String(encounterId);
            if (!encounterMap[key]) {
                encounterMap[key] = {
                    encounterId: encounterId,
                    encounterName: encounterId === 0 ? "Trash / Non-boss pulls" : fight.name,
                    fights: []
                };
            }
            encounterMap[key].fights.push(fight);
        }

        const encounterGroups = Object.values(encounterMap).sort((a, b) => a.encounterId - b.encounterId);
        for (const group of encounterGroups) {
            const rows = [];
            for (const hunter of hunters) {
                let pullCountIncluded = 0;
                let allTotalWeaveValues = [];
                for (const fight of group.fights) {
                    const casts = await this.getFightHunterCasts(fight, hunter);
                    const cachedMetrics = await this.getCachedFightHunterMetrics(fight, hunter, metricsSignature);
                    const metrics = cachedMetrics || this.buildMetricsFromEvents(casts.events || [], fight.start_time, casts.deaths || []);
                    if (!cachedMetrics) {
                        await this.setCachedFightHunterMetrics(fight, hunter, metricsSignature, metrics);
                    }
                    if (!metrics || !metrics.totalWeaveValues || metrics.totalWeaveValues.length === 0) {
                        continue;
                    }
                    pullCountIncluded += 1;
                    allTotalWeaveValues = allTotalWeaveValues.concat(metrics.totalWeaveValues);
                }

                if (allTotalWeaveValues.length === 0) {
                    rows.push({
                        hunterName: hunter.name,
                        hunterId: hunter.id,
                        pulls: pullCountIncluded,
                        weaves: 0,
                        average: 0,
                        median: 0
                    });
                    continue;
                }

                const average = allTotalWeaveValues.reduce((a, b) => a + b, 0) / allTotalWeaveValues.length;
                const median = calculateMedian(allTotalWeaveValues);
                rows.push({
                    hunterName: hunter.name,
                    hunterId: hunter.id,
                    pulls: pullCountIncluded,
                    weaves: allTotalWeaveValues.length,
                    average: average,
                    median: median
                });
            }
            rows.sort((a, b) => a.hunterName.localeCompare(b.hunterName));
            group.rows = rows;
        }

        this.summaryCache[summaryCacheKey] = encounterGroups;
        if (this.storage) {
            this.storage.putEncounterSummary({
                id: this.storage.getSummaryKey(this.reportId, summaryCacheKey),
                reportCode: this.reportId,
                summarySignatureV2: summaryCacheKey,
                withTrash: trashEnabled,
                encounterGroups: encounterGroups,
                computedAt: Date.now()
            }).catch(e => console.warn("IndexedDB summary write failed:", e));
        }
        return encounterGroups;
    }

    async analyzeFight(fightId) {
        const hunterPlots = document.getElementById("hunterPlots");
        hunterPlots.innerHTML = "";
        show("plot");

        const fight = this.data.fights.find(candidate => String(candidate.id) === String(fightId));
        if (!fight) {
            hunterPlots.textContent = "Selected fight could not be found.";
            return;
        }

        const hunters = this.getHunters();
        if (hunters.length === 0) {
            hunterPlots.textContent = "No hunters were found in this report.";
            renderReportSummary([]);
            return;
        }

        enableInput(false);
        try {
            const metricsSignature = getMetricsConfigSignature();
            for (const hunter of hunters) {
                const panel = createHunterPanel(hunterPlots, hunter.name + " (" + hunter.id + ")");
                let metrics = await this.getCachedFightHunterMetrics(fight, hunter, metricsSignature);
                if (metrics === null) {
                    const casts = await this.getFightHunterCasts(fight, hunter);
                    metrics = this.buildMetricsFromEvents(casts.events || [], fight.start_time, casts.deaths || []);
                    await this.setCachedFightHunterMetrics(fight, hunter, metricsSignature, metrics);
                }
                if (!metrics) {
                    panel.headerName.textContent = hunter.name + " (" + hunter.id + ")";
                    panel.headerStats.textContent = "no usable cast data";
                    panel.content.textContent = "No usable cast events for this hunter in this fight.";
                    continue;
                }
                panel.headerName.textContent = hunter.name + " (" + hunter.id + ")";
                panel.headerStats.textContent =
                    "weaves: " + metrics.zip3.length +
                    " | avg: " + metrics.average3.toFixed(1) + " ms" +
                    " | median: " + metrics.median3.toFixed(1) + " ms";
                drawPlot(metrics.zip1, metrics.average1, metrics.median1, metrics.x_limit, metrics.y12, panel.svg1, "Ability to weave time on " + fight.name);
                drawPlot(metrics.zip2, metrics.average2, metrics.median2, metrics.x_limit, metrics.y12, panel.svg2, "Weave to ability time on " + fight.name);
                drawPlot(metrics.zip3, metrics.average3, metrics.median3, metrics.x_limit, metrics.y3, panel.svg3, "Total weave time on " + fight.name);
            }
        } finally {
            enableInput(true);
        }
    }
}

function createHunterPanel(parent, title) {
    const panel = document.createElement("div");
    panel.className = "hunter-panel";

    const headerButton = document.createElement("button");
    headerButton.type = "button";
    const headerName = document.createElement("span");
    headerName.className = "hunter-panel-button-name";
    headerName.textContent = title;
    const headerStats = document.createElement("span");
    headerStats.className = "hunter-panel-button-stats";
    headerStats.textContent = "";
    headerButton.appendChild(headerName);
    headerButton.appendChild(headerStats);
    panel.appendChild(headerButton);

    const content = document.createElement("div");
    content.className = "hunter-panel-content";
    panel.appendChild(content);

    const svg1 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg1.setAttribute("width", "600");
    svg1.setAttribute("height", "400");
    const svg2 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg2.setAttribute("width", "600");
    svg2.setAttribute("height", "400");
    const svg3 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg3.setAttribute("width", "600");
    svg3.setAttribute("height", "400");
    content.appendChild(svg1);
    content.appendChild(svg2);
    content.appendChild(svg3);

    headerButton.addEventListener("click", function () {
        content.style.display = content.style.display === "block" ? "none" : "block";
    });

    parent.appendChild(panel);
    return { panel: panel, headerButton: headerButton, headerName: headerName, headerStats: headerStats, content: content, svg1: svg1, svg2: svg2, svg3: svg3 };
}

function renderReportSummary(encounterGroups) {
    const summaryRoot = document.getElementById("reportSummary");
    const summaryContent = document.getElementById("reportSummaryContent");
    if (!summaryRoot || !summaryContent) {
        return;
    }

    summaryContent.replaceChildren();

    const outerDetails = document.createElement("details");
    const outerSummary = document.createElement("summary");
    outerSummary.textContent = "All Pulls Hunter Summary (by Encounter)";
    outerDetails.appendChild(outerSummary);

    const outerBody = document.createElement("div");
    outerBody.style.padding = "6px 8px 8px 8px";
    outerDetails.appendChild(outerBody);

    if (!encounterGroups || encounterGroups.length === 0) {
        const emptyText = document.createElement("div");
        emptyText.style.padding = "8px";
        emptyText.textContent = "No hunter summary data available.";
        outerBody.appendChild(emptyText);
        summaryContent.appendChild(outerDetails);
        summaryRoot.style.display = "block";
        return;
    }

    for (const encounterGroup of encounterGroups) {
        const encounterContainer = document.createElement("div");
        encounterContainer.className = "summary-encounter";

        const encounterDetails = document.createElement("details");
        const encounterSummary = document.createElement("summary");
        encounterSummary.textContent = "Encounter " + encounterGroup.encounterId + ": " + encounterGroup.encounterName;
        encounterDetails.appendChild(encounterSummary);

        const encounterBody = document.createElement("div");
        encounterBody.style.padding = "6px";
        const table = document.createElement("table");
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        ["Hunter", "Pulls", "Weaves", "Avg Total Weave (ms)", "Median Total Weave (ms)"].forEach((headerText) => {
            const th = document.createElement("th");
            th.textContent = headerText;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        for (const row of encounterGroup.rows) {
            const tr = document.createElement("tr");
            const values = [
                row.hunterName + " (" + row.hunterId + ")",
                String(row.pulls),
                String(row.weaves),
                row.average.toFixed(1),
                row.median.toFixed(1)
            ];
            for (const value of values) {
                const td = document.createElement("td");
                td.textContent = value;
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        encounterBody.appendChild(table);
        encounterDetails.appendChild(encounterBody);
        encounterContainer.appendChild(encounterDetails);
        outerBody.appendChild(encounterContainer);
    }

    summaryContent.appendChild(outerDetails);
    summaryRoot.style.display = "block";
}

function renderReportSummaryLoading() {
    const summaryRoot = document.getElementById("reportSummary");
    const summaryContent = document.getElementById("reportSummaryContent");
    if (!summaryRoot || !summaryContent) {
        return;
    }
    summaryContent.textContent = "Loading all-pulls summary...";
    summaryRoot.style.display = "block";
}

//draws the graphs
function drawPlot(zip, average, median, x_limit, y_limit, svgTarget, title) {

    //calculate average

    average = average.toFixed(1);
    median = median.toFixed(1);
    //console.log(average);

    var svg = d3.select(svgTarget),
        margin = 100,
        width = svg.attr("width") - margin - 20, //400
        height = svg.attr("height") - margin //300

    var xScale = d3.scaleLinear().domain([0, x_limit]).range([0, width]),
        yScale = d3.scaleLinear().domain([0, y_limit]).range([height, 0]);

    // Title
    svg.append('text')
        .attr('x', width / 2 + 50)
        .attr('y', 40)
        .attr('text-anchor', 'middle')
        .style('font-family', 'Helvetica')
        .style('font-size', 20)
        .text(title);

    // X label
    svg.append('text')
        .attr('text-anchor', 'middle')
        .attr('transform', 'translate(' + svg.attr("width") / 2 + ', ' + (svg.attr("height") - 15) + ')')
        .style('font-family', 'Helvetica')
        .style('font-size', 12)
        .text('Time in seconds');

    // Y label
    svg.append('text')
        .attr('text-anchor', 'middle')
        .attr('transform', 'translate(20,' + svg.attr("height") / 2 + ')rotate(-90)')
        .style('font-family', 'Helvetica')
        .style('font-size', 12)
        .text('Time in milliseconds');

    //average label 
    svg.append('text')
        .attr('text-anchor', 'end')
        .attr('transform', 'translate(' + (svg.attr("width") - 10) + ', ' + (svg.attr("height") - 6) + ')')
        .style('font-family', 'Helvetica')
        .style('font-size', 12)
        .text("avg. = " + average + " | median = " + median);

    var g = svg.append("g")
        .attr("transform", "translate(" + 70 + "," + 50 + ")");

    g.append("g")
        .attr("transform", "translate(-10," + (height) + ")")
        .call(d3.axisBottom(xScale));

    g.append("g")
        .attr("transform", "translate(-10,0)")
        .call(d3.axisLeft(yScale).ticks(5));

    //values
    svg.append('g')
        .selectAll("dot")
        .data(zip)
        .enter()
        .append("circle")
        .attr("cx", function (d) { return xScale(d[0]); })
        .attr("cy", function (d) { return yScale(d[1]); })
        .attr("r", 4)
        .attr("transform", "translate(" + 60 + "," + 50 + ")")
        .style("fill", "#0000FF");
}

async function selectReport() {
    let el = document.querySelector("#code");
    let el_fightSelect = document.querySelector("#fightSelect");
    let fightSelectorBlock = document.querySelector("#fightSelectorBlock");
    const hunterPlots = document.getElementById("hunterPlots");

    el_fightSelect.innerHTML = "";
    if (fightSelectorBlock) {
        fightSelectorBlock.style.display = "none";
    }
    if (hunterPlots) {
        hunterPlots.innerHTML = "";
    }
    let reportId = el.value.trim();

    let urlmatch = reportId.match(/https:\/\/(?:[a-z]+\.)?(?:classic\.|www\.)?warcraftlogs\.com\/reports\/((?:a:)?\w+)/);
    if (urlmatch) reportId = urlmatch[1];

    //checks if the entered id is valid => otherwise red border
    if (!reportId || reportId.length !== 16 && reportId.length !== 18) {
        el.style.borderColor = "red";
        return;
    }
    //resets color
    el.style.borderColor = null;
    const currentRequestToken = ++summaryGenerationToken;
    const url = new URL(location.href);
    url.searchParams.set("id", reportId);
    history.replaceState({}, document.title, url.pathname + "?" + url.searchParams.toString() + url.hash);
    console.log("checking after");
    let trashEnabled = document.getElementById("trash_enabled").checked;
    if (!(reportId in reports) || (!reports[reportId].withTrash && trashEnabled))
        reports[reportId] = new Report(reportId, trashEnabled);
    enableInput(false);
    try {
        await reports[reportId].fetchData();
        console.log("Starting to add the fights....");
        for (let fight of reports[reportId].data.fights) {
            if (trashEnabled || fight.boss != 0) {
                let el_f = document.createElement("option");
                el_f.value = reportId + ";" + fight.id + ";" + fight.start_time + ";" + fight.name;
                const durationLabel = formatDurationMs(fight.end_time - fight.start_time);
                el_f.textContent = fight.name + " - " + fight.id + " (" + durationLabel + ")";
                el_fightSelect.appendChild(el_f);
            }
        }
        if (fightSelectorBlock && el_fightSelect.options.length > 0) {
            fightSelectorBlock.style.display = "block";
        }
        renderReportSummaryLoading();
        enableInput(true);
        const summaryRows = await reports[reportId].buildAllPullsSummary();
        if (currentRequestToken !== summaryGenerationToken) {
            return;
        }
        renderReportSummary(summaryRows);
    } catch (e) {
        if (currentRequestToken === summaryGenerationToken) {
            printError(e);
        }
    } finally {
        if (currentRequestToken === summaryGenerationToken) {
            enableInput(true);
        }
    }

}

function enableInput(enable = true) {
    let a = ["input", "button", "select"].map(s => document.querySelectorAll(s));
    for (let b of a) {
        for (let el of b) {
            el.disabled = !enable;
        }
    }
    const spinner = document.getElementById("loadingSpinner");
    if (spinner) {
        spinner.style.display = enable ? "none" : "inline-block";
    }
}

async function selectFight(index) {
    console.log("selecting Fight....");
    let el = document.querySelector("#fightSelect");
    let i;
    if (index)
        i = index;
    else
        i = el.selectedIndex;
    if (i === -1) return;
    let information = el.options[i].value;
    let [reportId, fightId] = information.split(";");
    await reports[reportId].analyzeFight(fightId);
}