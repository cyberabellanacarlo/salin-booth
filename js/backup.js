/* Silent Google Drive backup via Carlo's Apps Script web app.
   Guest screens never see this. Secrets live only in IndexedDB on the tablet. */
(function (global) {
  "use strict";

  var S = function () { return global.SalinStorage; };
  var timer = null;
  var running = false;
  var listenersBound = false;
  var backoffMs = 2000;
  var MAX_BACKOFF = 60000;
  var lastError = "";
  var listeners = [];

  function notify() {
    var i;
    for (i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (err) { /* ignore */ }
    }
  }

  function onChange(fn) { listeners.push(fn); }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || "");
        var comma = s.indexOf(",");
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function postPlain(url, payload) {
    /* text/plain avoids a CORS preflight. Apps Script reads e.postData.contents.
       The /exec URL may 302; fetch follows the redirect and we parse the body. */
    return fetch(url, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (err) { data = null; }
        return { httpOk: res.ok, status: res.status, data: data, raw: text };
      });
    });
  }

  function setLastError(msg) {
    lastError = msg || "";
    return S().setSettings({ lastBackupError: lastError }).then(function () {
      notify();
    });
  }

  function enqueuePhoto(photo) {
    return S().getSettings().then(function (settings) {
      if (!settings.backupEnabled) return null;
      return S().getQueueItem(photo.id).then(function (existing) {
        if (existing && existing.status === "ok") return existing;
        var item = {
          photoId: photo.id,
          filename: photo.filename,
          caption: photo.caption || "",
          status: "pending",
          attempts: existing ? existing.attempts : 0,
          lastError: "",
          createdAt: existing ? existing.createdAt : Date.now(),
          updatedAt: Date.now()
        };
        return S().enqueueBackup(item).then(function () {
          kick();
          notify();
          return item;
        });
      });
    });
  }

  /* Queue any not-yet-backed-up photos (used when the host turns backup on mid-event). */
  function enqueueMissing() {
    return Promise.all([S().getAllPhotos(), S().listQueue()]).then(function (pair) {
      var photos = pair[0], queue = pair[1];
      var byId = {};
      queue.forEach(function (q) { byId[q.photoId] = q; });
      var jobs = [];
      photos.forEach(function (p) {
        var q = byId[p.id];
        if (!q || q.status !== "ok") {
          jobs.push(enqueuePhoto(p));
        }
      });
      return Promise.all(jobs);
    });
  }

  function uploadItem(item, settings) {
    return S().getPhoto(item.photoId).then(function (photo) {
      if (!photo || !photo.framed) {
        return Promise.reject(new Error("Photo is missing from this tablet."));
      }
      return blobToBase64(photo.framed).then(function (imageBase64) {
        return postPlain(settings.backupUrl.trim(), {
          secret: settings.backupSecret,
          eventName: settings.eventName || "SALIN Event",
          eventDate: settings.eventDate || S().todayDate(),
          filename: item.filename,
          caption: item.caption || photo.caption || "",
          imageBase64: imageBase64
        });
      });
    }).then(function (result) {
      if (result.data && result.data.ok) {
        return result.data;
      }
      var err = (result.data && result.data.error) ? result.data.error : ("HTTP " + result.status);
      if (err === "unauthorized") err = "Wrong secret. Check the secret in Host Admin.";
      throw new Error(err);
    });
  }

  function processQueue() {
    if (running) return Promise.resolve();
    if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve();
    running = true;
    return S().getSettings().then(function (settings) {
      if (!settings.backupEnabled || !settings.backupUrl || !settings.backupSecret) {
        running = false;
        return null;
      }
      return S().listQueue().then(function (rows) {
        var pending = rows.filter(function (r) { return r.status !== "ok"; });
        if (!pending.length) {
          backoffMs = 2000;
          running = false;
          return setLastError("");
        }
        var item = pending.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); })[0];
        return uploadItem(item, settings).then(function (data) {
          return S().updateQueueItem(item.photoId, {
            status: "ok",
            lastError: "",
            remoteId: data.id || "",
            skipped: !!data.skipped
          }).then(function () {
            backoffMs = 2000;
            running = false;
            return setLastError("").then(function () {
              kick(400);
            });
          });
        }).catch(function (err) {
          var msg = (err && err.message) ? err.message : String(err);
          return S().updateQueueItem(item.photoId, {
            status: "pending",
            attempts: (item.attempts || 0) + 1,
            lastError: msg
          }).then(function () {
            running = false;
            return setLastError(msg).then(function () {
              kick(backoffMs);
              backoffMs = Math.min(MAX_BACKOFF, Math.round(backoffMs * 1.8));
            });
          });
        });
      });
    }).catch(function (err) {
      running = false;
      kick(backoffMs);
      return setLastError((err && err.message) ? err.message : String(err));
    });
  }

  function kick(delay) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      processQueue();
    }, typeof delay === "number" ? delay : 200);
  }

  function bindNetwork() {
    if (listenersBound) return;
    listenersBound = true;
    window.addEventListener("online", function () {
      backoffMs = 2000;
      kick(300);
    });
    window.addEventListener("offline", function () {
      /* stay queued silently */
    });
  }

  function start() {
    bindNetwork();
    kick(500);
  }

  function testConnection(url, secret, eventName, eventDate) {
    if (!url) return Promise.reject(new Error("Please paste the Web App URL first."));
    if (!secret) return Promise.reject(new Error("Please paste the secret first."));
    return postPlain(url.trim(), {
      secret: secret,
      eventName: eventName || "SALIN Event",
      eventDate: eventDate || S().todayDate(),
      test: true
    }).then(function (result) {
      if (result.data && result.data.ok) return result.data;
      var err = (result.data && result.data.error) ? result.data.error : ("HTTP " + result.status);
      if (err === "unauthorized") err = "Wrong secret. Copy it again from the Apps Script execution log.";
      if (!result.data) err = "No reply we could read. Check the Web App URL, and that access is set to Anyone.";
      throw new Error(err);
    });
  }

  function getLastError() { return lastError; }

  global.SalinBackup = {
    start: start,
    kick: kick,
    enqueuePhoto: enqueuePhoto,
    enqueueMissing: enqueueMissing,
    testConnection: testConnection,
    postPlain: postPlain,
    onChange: onChange,
    getLastError: getLastError,
    processQueue: processQueue
  };
})(window);
