//stores settings

function saveSettings() {
    localStorage.setItem("instants", document.getElementById("instants").checked);
    localStorage.setItem("outliers", document.getElementById("outliers").value);
    localStorage.setItem("ignore_shortest", document.getElementById("ignore_shortest").value);
    localStorage.setItem("ignore_longest", document.getElementById("ignore_longest").value);
    localStorage.setItem("death_cutoff", document.getElementById("death_cutoff").value);
    localStorage.setItem("trash_enabled", document.getElementById("trash_enabled").checked);
    localStorage.setItem("y12", document.getElementById("y12").value);
    localStorage.setItem("y3", document.getElementById("y3").value);
    const oauthClientInput = document.getElementById("oauth_client_id");
    if (oauthClientInput) {
        localStorage.setItem("oauth_client_id", oauthClientInput.value.trim());
    }



    console.log("local storage");
    for (let i = 0; i < localStorage.length; i++) {
        console.log(localStorage.key(i) + "=[" + localStorage.getItem(localStorage.key(i)) + "]");
    }
    selectFight();
}

function restoreDefaults() {
    localStorage.setItem("instants", true);
    document.getElementById("instants").checked = true;
    localStorage.setItem("trash_enabled", false);
    document.getElementById("trash_enabled").checked = false;
    localStorage.setItem("y12", 2500);
    document.getElementById("y12").value = 2500;
    localStorage.setItem("y3", 4000);
    document.getElementById("y3").value = 4000;
    localStorage.setItem("outliers", 5000);
    document.getElementById("outliers").value = 5000;
    localStorage.setItem("ignore_shortest", 0);
    document.getElementById("ignore_shortest").value = 0;
    localStorage.setItem("ignore_longest", 0);
    document.getElementById("ignore_longest").value = 0;
    localStorage.setItem("death_cutoff", 0);
    document.getElementById("death_cutoff").value = 0;
    const oauthClientInput = document.getElementById("oauth_client_id");
    if (oauthClientInput) {
        localStorage.setItem("oauth_client_id", "");
        oauthClientInput.value = "";
    }

    console.log("local storage");
    for (let i = 0; i < localStorage.length; i++) {
        console.log(localStorage.key(i) + "=[" + localStorage.getItem(localStorage.key(i)) + "]");
    }
    if (typeof refreshAuthStatusUI === "function") {
        refreshAuthStatusUI();
    }
    selectFight();
}

function loadSettings() {
    if (localStorage.getItem("instants") == undefined) {
        localStorage.setItem("instants", true);
    }
    if (localStorage.getItem("y12") == undefined) {
        localStorage.setItem("y12", 2500);
    }
    if (localStorage.getItem("y3") == undefined) {
        localStorage.setItem("y3", 4000);
    }
    if (localStorage.getItem("outliers") == undefined) {
        localStorage.setItem("outliers", 5000);
    }
    if (localStorage.getItem("trash_enabled") == undefined) {
        localStorage.setItem("trash_enabled", false);
    }
    if (localStorage.getItem("ignore_shortest") == undefined) {
        localStorage.setItem("ignore_shortest", 0);
    }
    if (localStorage.getItem("ignore_longest") == undefined) {
        localStorage.setItem("ignore_longest", 0);
    }
    if (localStorage.getItem("death_cutoff") == undefined) {
        localStorage.setItem("death_cutoff", 0);
    }
    if (localStorage.getItem("oauth_client_id") == undefined) {
        localStorage.setItem("oauth_client_id", "");
    }
    document.getElementById("instants").checked = localStorage.getItem("instants") === "true";
    document.getElementById("y12").value = localStorage.getItem("y12");
    document.getElementById("y3").value = localStorage.getItem("y3");
    document.getElementById("outliers").value = localStorage.getItem("outliers");
    document.getElementById("ignore_shortest").value = localStorage.getItem("ignore_shortest");
    document.getElementById("ignore_longest").value = localStorage.getItem("ignore_longest");
    document.getElementById("death_cutoff").value = localStorage.getItem("death_cutoff");
    document.getElementById("trash_enabled").checked = localStorage.getItem("trash_enabled") === "true";
    const oauthClientInput = document.getElementById("oauth_client_id");
    if (oauthClientInput) {
        oauthClientInput.value = localStorage.getItem("oauth_client_id");
    }
    if (typeof refreshAuthStatusUI === "function") {
        refreshAuthStatusUI();
    }
}
