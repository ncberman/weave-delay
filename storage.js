"use strict";

const WEAVE_DB_NAME = "weaveDelayDb";
const WEAVE_DB_VERSION = 1;

class WeaveDelayStorage {
    constructor() {
        this.dbPromise = null;
    }

    async open() {
        if (this.dbPromise) {
            return this.dbPromise;
        }
        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(WEAVE_DB_NAME, WEAVE_DB_VERSION);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                this.upgrade(db);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return this.dbPromise;
    }

    upgrade(db) {
        if (!db.objectStoreNames.contains("reports")) {
            db.createObjectStore("reports", { keyPath: "reportCode" });
        }

        if (!db.objectStoreNames.contains("fightEvents")) {
            const fightEvents = db.createObjectStore("fightEvents", { keyPath: "id" });
            fightEvents.createIndex("byReport", "reportCode", { unique: false });
            fightEvents.createIndex("byReportFight", ["reportCode", "fightId"], { unique: true });
        }

        if (!db.objectStoreNames.contains("hunterEvents")) {
            const hunterEvents = db.createObjectStore("hunterEvents", { keyPath: "id" });
            hunterEvents.createIndex("byReportFightHunter", ["reportCode", "fightId", "hunterId"], { unique: true });
        }

        if (!db.objectStoreNames.contains("metricsSnapshots")) {
            const metrics = db.createObjectStore("metricsSnapshots", { keyPath: "id" });
            metrics.createIndex("byReportFight", ["reportCode", "fightId"], { unique: false });
            metrics.createIndex("byReportFightHunter", ["reportCode", "fightId", "hunterId"], { unique: false });
        }

        if (!db.objectStoreNames.contains("encounterSummaries")) {
            const summaries = db.createObjectStore("encounterSummaries", { keyPath: "id" });
            summaries.createIndex("byReport", "reportCode", { unique: false });
        }
    }

    async get(storeName, key) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly");
            const request = tx.objectStore(storeName).get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async put(storeName, value) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            tx.objectStore(storeName).put(value);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    getFightKey(reportCode, fightId) {
        return String(reportCode) + ":" + String(fightId);
    }

    getHunterKey(reportCode, fightId, hunterId) {
        return String(reportCode) + ":" + String(fightId) + ":" + String(hunterId);
    }

    getMetricsKey(reportCode, fightId, hunterId, signature) {
        return String(reportCode) + ":" + String(fightId) + ":" + String(hunterId) + ":" + String(signature);
    }

    getSummaryKey(reportCode, signature) {
        return String(reportCode) + ":" + String(signature);
    }

    async getReport(reportCode) {
        return this.get("reports", String(reportCode));
    }

    async putReport(record) {
        return this.put("reports", record);
    }

    async getFightEvents(reportCode, fightId) {
        return this.get("fightEvents", this.getFightKey(reportCode, fightId));
    }

    async putFightEvents(record) {
        return this.put("fightEvents", record);
    }

    async getHunterEvents(reportCode, fightId, hunterId) {
        return this.get("hunterEvents", this.getHunterKey(reportCode, fightId, hunterId));
    }

    async putHunterEvents(record) {
        return this.put("hunterEvents", record);
    }

    async getMetricsSnapshot(reportCode, fightId, hunterId, signature) {
        return this.get("metricsSnapshots", this.getMetricsKey(reportCode, fightId, hunterId, signature));
    }

    async putMetricsSnapshot(record) {
        return this.put("metricsSnapshots", record);
    }

    async getEncounterSummary(reportCode, signature) {
        return this.get("encounterSummaries", this.getSummaryKey(reportCode, signature));
    }

    async putEncounterSummary(record) {
        return this.put("encounterSummaries", record);
    }
}

window.weaveDelayStorage = new WeaveDelayStorage();
