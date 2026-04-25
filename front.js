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

    if (idParam) {
        document.getElementById("code").value = idParam;
    }
}


