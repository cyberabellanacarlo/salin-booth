/* SALIN booth storage. IndexedDB only. Swap this file later for a cloud backend. */
(function (global) {
  "use strict";

  var DB_NAME = "salin-booth";
  var DB_VERSION = 1;
  var dbPromise = null;

  var DEFAULT_SETTINGS = {
    pin: "1234",
    backupEnabled: false,
    backupUrl: "",
    backupSecret: "",
    eventName: "SALIN Eco Souvenir Bar",
    eventDate: "",
    lastBackupError: "",
    lastExportAt: 0
  };

  function todayDate() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains("photos")) {
          var photos = db.createObjectStore("photos", { keyPath: "id" });
          photos.createIndex("byCreated", "createdAt");
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("backupQueue")) {
          var q = db.createObjectStore("backupQueue", { keyPath: "photoId" });
          q.createIndex("byStatus", "status");
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error("aborted")); };
    });
  }

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function init() {
    return openDb().then(function () { return getSettings(); });
  }

  function addPhoto(photo) {
    return openDb().then(function (db) {
      var tx = db.transaction("photos", "readwrite");
      tx.objectStore("photos").put(photo);
      return txDone(tx).then(function () { return photo; });
    });
  }

  function getPhoto(id) {
    return openDb().then(function (db) {
      return reqToPromise(db.transaction("photos", "readonly").objectStore("photos").get(id));
    });
  }

  function getAllPhotos() {
    return openDb().then(function (db) {
      return reqToPromise(db.transaction("photos", "readonly").objectStore("photos").getAll())
        .then(function (rows) {
          rows = rows || [];
          rows.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
          return rows;
        });
    });
  }

  function deletePhoto(id) {
    return openDb().then(function (db) {
      var tx = db.transaction(["photos", "backupQueue"], "readwrite");
      tx.objectStore("photos").delete(id);
      tx.objectStore("backupQueue").delete(id);
      return txDone(tx);
    });
  }

  function clearPhotos() {
    return openDb().then(function (db) {
      var tx = db.transaction(["photos", "backupQueue"], "readwrite");
      tx.objectStore("photos").clear();
      tx.objectStore("backupQueue").clear();
      return txDone(tx);
    });
  }

  function countPhotos() {
    return openDb().then(function (db) {
      return reqToPromise(db.transaction("photos", "readonly").objectStore("photos").count());
    });
  }

  function getSettings() {
    return openDb().then(function (db) {
      return reqToPromise(db.transaction("settings", "readonly").objectStore("settings").get("app"))
        .then(function (row) {
          var s = {};
          var k;
          for (k in DEFAULT_SETTINGS) {
            if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) s[k] = DEFAULT_SETTINGS[k];
          }
          if (row && row.value) {
            for (k in row.value) {
              if (Object.prototype.hasOwnProperty.call(row.value, k)) s[k] = row.value[k];
            }
          }
          if (!s.eventDate) s.eventDate = todayDate();
          return s;
        });
    });
  }

  function setSettings(patch) {
    return getSettings().then(function (cur) {
      var k;
      for (k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) cur[k] = patch[k];
      }
      return openDb().then(function (db) {
        var tx = db.transaction("settings", "readwrite");
        tx.objectStore("settings").put({ key: "app", value: cur });
        return txDone(tx).then(function () { return cur; });
      });
    });
  }

  function enqueueBackup(item) {
    return openDb().then(function (db) {
      var tx = db.transaction("backupQueue", "readwrite");
      tx.objectStore("backupQueue").put(item);
      return txDone(tx);
    });
  }

  function getQueueItem(photoId) {
    return openDb().then(function (db) {
      return reqToPromise(db.transaction("backupQueue", "readonly").objectStore("backupQueue").get(photoId));
    });
  }

  function listQueue() {
    return openDb().then(function (db) {
      return reqToPromise(db.transaction("backupQueue", "readonly").objectStore("backupQueue").getAll())
        .then(function (rows) { return rows || []; });
    });
  }

  function updateQueueItem(photoId, patch) {
    return getQueueItem(photoId).then(function (row) {
      if (!row) return null;
      var k;
      for (k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) row[k] = patch[k];
      }
      row.updatedAt = Date.now();
      return enqueueBackup(row).then(function () { return row; });
    });
  }

  function removeQueueItem(photoId) {
    return openDb().then(function (db) {
      var tx = db.transaction("backupQueue", "readwrite");
      tx.objectStore("backupQueue").delete(photoId);
      return txDone(tx);
    });
  }

  function countByQueueStatus(status) {
    return listQueue().then(function (rows) {
      var n = 0, i;
      for (i = 0; i < rows.length; i++) {
        if (rows[i].status === status) n++;
      }
      return n;
    });
  }

  function countSinceExport() {
    return Promise.all([getSettings(), getAllPhotos()]).then(function (pair) {
      var since = Number(pair[0].lastExportAt) || 0;
      var n = 0, i, photos = pair[1];
      for (i = 0; i < photos.length; i++) {
        if ((photos[i].createdAt || 0) > since) n++;
      }
      return n;
    });
  }

  function eventSlug(name) {
    var s = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s || "Photos";
  }

  function formatEventDate(iso) {
    var p = String(iso || "").split("-");
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (p.length >= 3) {
      var y = Number(p[0]), m = Number(p[1]), d = Number(p[2]);
      if (y && m) return months[m - 1] + " " + d + ", " + y;
    }
    return dateLabelFromNow();
  }

  function dateLabelFromNow() {
    var d = new Date();
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  function zipName(settings) {
    var date = (settings && settings.eventDate) || todayDate();
    var slug = eventSlug(settings && settings.eventName);
    if (slug === "Photos") return "SALIN-Photos-" + date + ".zip";
    return "SALIN-" + slug + "-" + date + ".zip";
  }

  global.SalinStorage = {
    init: init,
    addPhoto: addPhoto,
    getPhoto: getPhoto,
    getAllPhotos: getAllPhotos,
    deletePhoto: deletePhoto,
    clearPhotos: clearPhotos,
    countPhotos: countPhotos,
    getSettings: getSettings,
    setSettings: setSettings,
    enqueueBackup: enqueueBackup,
    getQueueItem: getQueueItem,
    listQueue: listQueue,
    updateQueueItem: updateQueueItem,
    removeQueueItem: removeQueueItem,
    countBackedUp: function () { return countByQueueStatus("ok"); },
    countPendingBackup: function () { return countByQueueStatus("pending"); },
    todayDate: todayDate,
    countSinceExport: countSinceExport,
    eventSlug: eventSlug,
    formatEventDate: formatEventDate,
    zipName: zipName
  };
})(window);
