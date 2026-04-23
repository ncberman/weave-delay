"use strict";

const throttleTime = 150;
const reports = {};
const wclUserGraphqlUrl = "https://www.warcraftlogs.com/api/v2/user";
const wclDebugEntries = [];
const maxWclDebugEntries = 20;

let nextRequestTime = 0;

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

function summarizeDebugValue(value, depth = 0) {
    if (depth > 4) {
        return "[max-depth]";
    }
    if (Array.isArray(value)) {
        const maxItems = 25;
        if (value.length > maxItems) {
            return {
                __arrayLength: value.length,
                sample: value.slice(0, maxItems).map(item => summarizeDebugValue(item, depth + 1))
            };
        }
        return value.map(item => summarizeDebugValue(item, depth + 1));
    }
    if (value && typeof value === "object") {
        const result = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            result[key] = summarizeDebugValue(nestedValue, depth + 1);
        }
        return result;
    }
    if (typeof value === "string" && value.length > 500) {
        return value.slice(0, 500) + "...[truncated]";
    }
    return value;
}

function pushWclDebugEntry(label, payload) {
    const entry = {
        at: new Date().toISOString(),
        label: label,
        payload: summarizeDebugValue(payload)
    };
    wclDebugEntries.push(entry);
    if (wclDebugEntries.length > maxWclDebugEntries) {
        wclDebugEntries.splice(0, wclDebugEntries.length - maxWclDebugEntries);
    }
    renderWclDebugOutput();
}

function renderWclDebugOutput() {
    const output = document.getElementById("apiDebugOutput");
    if (!output) {
        return;
    }
    output.textContent = JSON.stringify(wclDebugEntries, null, 2);
}

function clearWclDebugOutput() {
    wclDebugEntries.length = 0;
    renderWclDebugOutput();
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
    pushWclDebugEntry("GraphQL request", {
        query: query,
        variables: variables
    });

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
        pushWclDebugEntry("GraphQL auth failure", { status: response.status });
        if (typeof disconnectWarcraftLogs === "function") {
            disconnectWarcraftLogs();
        }
        throw new Error("Warcraft Logs authorization failed. Reconnect Warcraft Logs in Settings.");
    }
    if (!response.ok) {
        pushWclDebugEntry("GraphQL HTTP failure", { status: response.status });
        throw new Error("Fetch error (" + response.status + ").");
    }

    const payload = await response.json();
    pushWclDebugEntry("GraphQL response", payload);
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
    return {
        timestamp: timestamp,
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

    const friendlies = (report.masterData && report.masterData.actors ? report.masterData.actors : [])
        .filter(actor => actor.type === "Player")
        .map(actor => ({
            id: actor.id,
            name: actor.name
        }));

    const abilityByGameId = {};
    const abilities = report.masterData && report.masterData.abilities ? report.masterData.abilities : [];
    for (const ability of abilities) {
        if (ability && Number.isFinite(Number(ability.gameID)) && ability.name) {
            abilityByGameId[Number(ability.gameID)] = ability.name;
        }
    }

    return {
        fights: fights,
        friendlies: friendlies,
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
            sourceID: Number(sourceId),
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

class Report {

    constructor(reportId, playerName, withTrash) {
        this.reportId = reportId;
        this.playerName = playerName;
        this.plotData = {};
        this.withTrash = withTrash;
    }

    async fetchData() {
        console.log("inside fetchData...");
        if ("data" in this) {
            ("data exists, returning...");
            return;
        }
        this.friendlies = {};
        this.data = await fetchReportMeta(this.reportId);
        this.abilityByGameId = this.data.abilityByGameId || {};
        console.log("done getting data");
        for (let friendlies of this.data.friendlies) {
            this.friendlies[friendlies.name] = friendlies.id;
        }
        console.log(this.friendlies);
        this.fetchCasts();
    }

    async fetchCasts() {
        console.log("inside fetchCasts...");
        if ("casts" in this) {
            console.log("casts exists, returning...");
            return;
        }
        enableInput(false);
        this.casts = {};
        let source = this.friendlies[this.playerName];
        if (source == undefined) {
            enableInput(true);
            const availablePlayers = Object.keys(this.friendlies).sort((a, b) => a.localeCompare(b));
            const playerListText = availablePlayers.length
                ? "\n\nPlayers in this log:\n- " + availablePlayers.join("\n- ")
                : "\n\nNo player entries were found in the report master data.";
            printError("The player defined is not part of the combat log." + playerListText);
            location.href = location.origin + location.pathname + `?id=${getParameterByName("id")}`;
            return;
        }

        let trashEnabled = document.getElementById("trash_enabled").checked;
        for (let fight of this.data.fights) {
            if (trashEnabled || fight.boss != 0) {
                this.casts[fight.id] = await fetchFightCasts(this.reportId, fight.id, source, fight.start_time, fight.end_time, this.abilityByGameId);
            }
        }
        console.log("done in casts");
        enableInput(true);
        selectFight();
    }

    doMath(fightId, start_time, name) {
        let mutable_casts = this.casts[fightId].events
            .filter(cast => cast && cast.ability && cast.ability.name && Number.isFinite(cast.timestamp))
            .slice()
            .sort((a, b) => a.timestamp - b.timestamp);

        if (mutable_casts.length === 0) {
            d3.selectAll("svg > *").remove();
            alert("No cast events found for this fight/player. Try another fight or verify the player name.");
            return;
        }
        const abilityDebugCounts = {};
        for (const cast of mutable_casts) {
            const ability = cast.ability.name;
            abilityDebugCounts[ability] = (abilityDebugCounts[ability] || 0) + 1;
        }
        console.log("Ability counts before whitelist:", abilityDebugCounts);
        //console.log(this.casts);
        //this removes any ability in blacklist from the cast list, also removes any windfury proccs
        let melee_list = ["Melee", "Raptor Strike"];
        if (localStorage.getItem("instants") == "true") {
            var whitelist = ["Arcane Shot", "Auto Shot", "Steady Shot", "Scorpid Sting", "Serpent Sting", "Multi-Shot", "Raptor Strike", "Melee"];
        } else {
            var whitelist = ["Auto Shot", "Steady Shot", "Multi-Shot", "Raptor Strike", "Melee"];
        }

        console.log("the whitelist is: " + whitelist);
        for (let i = 0; i < mutable_casts.length; i++) {
            if (!(whitelist.includes(mutable_casts[i].ability.name))) {
                //console.log("Remove this: " + mutable_casts[i].ability.name);
                mutable_casts.splice(i, 1);
                i--;
            }
            else if (mutable_casts[i].ability.name == "Melee" && i != 0) {
                if (melee_list.includes(mutable_casts[i - 1].ability.name)) {
                    mutable_casts.splice(i - 1, 1);
                    i--;
                }
            }
        }

        let timestamps_weave = [];
        let ability_weave_time = [];
        let weave_ability_time = [];

        //calculates the difference in time between weaves and abilities
        for (let i = 0; i < mutable_casts.length; i++) {
            let cast = mutable_casts[i];
            if ((cast.ability.name == "Melee" || cast.ability.name == "Raptor Strike") && i >= 1 && i < mutable_casts.length - 1) {
                timestamps_weave.push((cast.timestamp - start_time) / 1000);
                ability_weave_time.push(cast.timestamp - mutable_casts[i - 1].timestamp);
                weave_ability_time.push(mutable_casts[i + 1].timestamp - cast.timestamp);
            }
        }

        let total_weave_time = [];
        for (let i = 0; i < ability_weave_time.length; i++) {
            total_weave_time.push(ability_weave_time[i] + weave_ability_time[i]);
        }


        //remove outliers
        let outliers = document.getElementById("outliers").value;
        for (let i = 0; i < ability_weave_time.length; i++) {
            if (total_weave_time[i] > outliers) {
                console.log("Zeit: " + total_weave_time[i]);
                ability_weave_time.splice(i, 1);
                weave_ability_time.splice(i, 1);
                total_weave_time.splice(i, 1);
                timestamps_weave.splice(i, 1);
                i--;
            }
        }

        //draws the plots
        let y12 = localStorage.getItem("y12");
        let y3 = localStorage.getItem("y3");

        //calc averages
        let average1 = (ability_weave_time.reduce((a, b) => a + b, 0) / ability_weave_time.length) || 0;
        let average2 = (weave_ability_time.reduce((a, b) => a + b, 0) / ability_weave_time.length) || 0;
        let average3 = (total_weave_time.reduce((a, b) => a + b, 0) / ability_weave_time.length) || 0;

        //prepare data for d3
        let zip1 = d3.zip(timestamps_weave, ability_weave_time);
        let zip2 = d3.zip(timestamps_weave, weave_ability_time);
        let zip3 = d3.zip(timestamps_weave, total_weave_time);

        //hide over limit y12
        for (let i = 0; i < zip1.length; i++) {
            if (zip1[i][1] > y12 || zip2[i][1] > y12 || zip3[i][1] > y3) {
                zip1.splice(i, 1);
                zip2.splice(i, 1);
                zip3.splice(i, 1);
                i--;
            }
        }

        show("plot");
        d3.selectAll("svg > *").remove();
        const lastCast = mutable_casts[mutable_casts.length - 1];
        if (!lastCast || !Number.isFinite(lastCast.timestamp)) {
            alert("Could not build graph range from cast events.");
            return;
        }
        let x_limit = (lastCast.timestamp - start_time) / 1000 + 10;
        drawPlot(zip1, average1, x_limit, y12, "#svg1", "Ability to weave time on " + name);
        drawPlot(zip2, average2, x_limit, y12, "#svg2", "Weave to ability time on " + name);
        drawPlot(zip3, average3, x_limit, y3, "#svg3", "Total weave time on " + name);


    }



}

//draws the graphs
function drawPlot(zip, average, x_limit, y_limit, svg_id, title) {

    //calculate average

    average = average.toFixed(1);
    //console.log(average);

    var svg = d3.select(svg_id),
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
        .attr('text-anchor', 'middle')
        .attr('transform', 'translate(' + (svg.attr("width") - 55) + ', ' + (svg.attr("height") - 6) + ')')
        .style('font-family', 'Helvetica')
        .style('font-size', 12)
        .text("avg. time = " + average);

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

function selectReport() {

    let wcl = getParameterByName('id');
    let player = getParameterByName('player');
    let el = document.querySelector("#code");
    let el_playerSelect = document.querySelector("#pname");
    let el_fightSelect = document.querySelector("#fightSelect");

    let playerParam = el_playerSelect === null ? "" : "&player=" + el_playerSelect.value.charAt(0).toUpperCase() + el_playerSelect.value.slice(1);;
    //TODO: making URL instant load copied fight
    //let fightParam = el_fightSelect === null ? "" : "&fight=" + el_fightSelect.value;

    el_fightSelect.innerHTML = "";
    let reportId = el.value;

    if (!wcl || wcl !== reportId || !player || player !== el_playerSelect.value) {
        //TODO: look above
        //location.href = location.origin + location.pathname + '?id=' + el.value + playerParam + fightParam;
        location.href = location.origin + location.pathname + '?id=' + el.value + playerParam;
        return;
    }

    let urlmatch = reportId.match(/https:\/\/(?:[a-z]+\.)?(?:classic\.|www\.)?warcraftlogs\.com\/reports\/((?:a:)?\w+)/);
    if (urlmatch) reportId = urlmatch[1];

    //checks if the entered id is valid => otherwise red border
    if (!reportId || reportId.length !== 16 && reportId.length !== 18) {
        el.style.borderColor = "red";
        return;
    }
    //resets color
    el.style.borderColor = null;
    console.log("checking after");
    let trashEnabled = document.getElementById("trash_enabled").checked;
    if (!(reportId in reports) || (!reports[reportId].withTrash && trashEnabled)) 
        reports[reportId] = new Report(reportId, getParameterByName('player'), trashEnabled);
    reports[reportId].fetchData().then(() => {
        console.log("Starting to add the fights....");
        for (let fight of reports[reportId].data.fights) {
            if (trashEnabled || fight.boss != 0) {
                let el_f = document.createElement("option");
                el_f.value = reportId + ";" + fight.id + ";" + fight.start_time + ";" + fight.name;
                el_f.textContent = fight.name + " - " + fight.id;
                el_fightSelect.appendChild(el_f);
            }
        }
    }).catch(printError);

}

function enableInput(enable = true) {
    let a = ["input", "button", "select"].map(s => document.querySelectorAll(s));
    for (let b of a) {
        for (let el of b) {
            el.disabled = !enable;
        }
    }
}

function selectFight(index) {
    console.log("selecting Fight....");
    let el = document.querySelector("#fightSelect");
    let i;
    if (index)
        i = index;
    else
        i = el.selectedIndex;
    if (i === -1) return;
    let information = el.options[i].value;
    let [reportId, fightId, start_time, name] = information.split(";");
    reports[reportId].doMath(fightId, start_time, name);
}