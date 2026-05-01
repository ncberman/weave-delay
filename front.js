function showAndHide(div) {
    var x = document.getElementById(div);
    if (x.style.display === "none") {
        x.style.display = "block";
    } else {
        x.style.display = "none";
    }
}

function hide(div) {
    var x = document.getElementById(div);
    if (x.style.display != "none") {
        x.style.display = "none";
    }
}

function show(div) {
    var x = document.querySelectorAll("#plot");
    for (let i of x) {
        i.style.display = "inline-block";
    }
}

function showAndHideDisclaimer() {
    showAndHide("disclaimer");
    hide("changelog");
    hide("tutorial");
    hide("settings");
}

function showAndHideChangelog() {
    showAndHide("changelog");
    hide("disclaimer");
    hide("tutorial");
    hide("settings");
}
function showAndHideTutorial() {
    showAndHide("tutorial");
    hide("changelog");
    hide("disclaimer");
    hide("settings");
}

function showAndHideSettings() {
    showAndHide("settings");
    hide("changelog");
    hide("disclaimer");
    hide("tutorial");
}

function initializeFilterPanelInteractions() {
    const filterIds = ["instants", "outliers", "ignore_shortest", "ignore_longest", "death_cutoff", "trash_enabled"];
    for (const id of filterIds) {
        const el = document.getElementById(id);
        if (!el || el.dataset.filterBound === "true") {
            continue;
        }
        el.dataset.filterBound = "true";
        el.addEventListener("change", () => {
            saveSettings();
        });
    }
}

async function loadPage() {
    scroll(0, 0);
    loadSettings();
    initializeFilterPanelInteractions();
    if (typeof initializeOAuthPanelInteractions === "function") {
        initializeOAuthPanelInteractions();
    }
    try {
        if (typeof initializeOAuthFromUrl === "function") {
            await initializeOAuthFromUrl();
        }
    } catch (e) {
        console.error(e);
        alert("OAuth error:\n" + e.message + "\n\nClick the auth panel to reconnect.");
    }
    if (typeof refreshAuthStatusUI === "function") {
        refreshAuthStatusUI();
    }
    const idParam = getParameterByName('id');

    if (idParam) {
        document.getElementById("code").value = idParam;
    }
}


