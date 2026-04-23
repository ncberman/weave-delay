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
    hide("apiDebug");
}

function showAndHideChangelog() {
    showAndHide("changelog");
    hide("disclaimer");
    hide("tutorial");
    hide("settings");
    hide("apiDebug");
}
function showAndHideTutorial() {
    showAndHide("tutorial");
    hide("changelog");
    hide("disclaimer");
    hide("settings");
    hide("apiDebug");
}

function showAndHideSettings() {
    showAndHide("settings");
    hide("changelog");
    hide("disclaimer");
    hide("tutorial");
    hide("apiDebug");
}

function showAndHideApiDebug() {
    showAndHide("apiDebug");
    hide("changelog");
    hide("disclaimer");
    hide("tutorial");
    hide("settings");
}

async function loadPage() {
    scroll(0, 0);
    loadSettings();
    try {
        if (typeof initializeOAuthFromUrl === "function") {
            await initializeOAuthFromUrl();
        }
    } catch (e) {
        console.error(e);
        alert("OAuth error:\n" + e.message + "\n\nReconnect Warcraft Logs in Settings.");
    }
    if (typeof refreshAuthStatusUI === "function") {
        refreshAuthStatusUI();
    }
    const idParam = getParameterByName('id');
    //const fightParam = getParameterByName('fight');
    const playerParam = getParameterByName('player');

    if (idParam) {
        document.getElementById("code").value = idParam;
    }

    if (idParam && playerParam) {
        console.log("Setting params...");
        document.getElementById("pname").value = playerParam;
        selectReport();
    }

    //if (fightParam) {
    //    let selectedIndex = parseInt(fightParam);
    //    sleep(5000);
    //    selectFight(selectedIndex);
    //}
}


