(function () {
  "use strict";

  var storage = window.SalinStorage;
  var frame = window.SalinFrame;
  var zip = window.SalinZip;
  var backup = window.SalinBackup;

  var video = document.getElementById("cam");
  var countdownEl = document.getElementById("countdown");
  var flashEl = document.getElementById("flash");
  var camErrorEl = document.getElementById("cam-error");
  var shutterBtn = document.getElementById("btn-shutter");
  var switchBtn = document.getElementById("btn-switch");
  var captionInput = document.getElementById("caption-input");
  var captionPreview = document.getElementById("caption-preview");
  var charCount = document.getElementById("char-count");
  var boardGrid = document.getElementById("board-grid");
  var boardScroll = document.getElementById("board-scroll");
  var thanksBar = document.getElementById("thanks-bar");
  var backBoothBtn = document.getElementById("btn-back-booth");

  var stream = null;
  var facing = "user";
  var busy = false;
  var capturedBlob = null;
  var capturedUrl = "";
  var returnTimer = null;
  var returnLeft = 0;
  var justPinnedId = null;
  var pickMode = false;
  var selectedIds = {};
  var pinBuffer = "";
  var currentView = "booth";
  var afterPin = false;
  var photoCountCache = 0;
  var persistOk = false;
  var nePinBuffer = "";

  function $(id) { return document.getElementById(id); }

  function showView(name) {
    currentView = name;
    $("view-booth").classList.toggle("hidden", name !== "booth");
    $("view-caption").classList.toggle("hidden", name !== "caption");
    $("view-board").classList.toggle("hidden", name !== "board");
    /* flowers on booth/caption are the page-level ones; board has its own */
    var pageFlowers = document.querySelectorAll("body > .fl");
    var i;
    for (i = 0; i < pageFlowers.length; i++) {
      pageFlowers[i].style.display = name === "board" ? "none" : "";
    }
    if (name !== "booth") {
      stopCamera();
      if (window.SalinCompliments) SalinCompliments.stop();
    } else if (window.SalinCompliments) {
      SalinCompliments.start();
    }
    if (name === "board") updateBoardEvent();
  }

  function kindCamError(err) {
    var name = (err && err.name) || "";
    var msg;
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      msg = "The camera is off for this page. On iPad, tap AA or the lock icon in the address bar, allow the camera, then try again. On Android, tap the lock icon and allow the camera.";
    } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      msg = "No camera was found on this device. You can still open the souvenir wall from the button below.";
    } else if (name === "NotReadableError" || name === "TrackStartError") {
      msg = "The camera is busy in another app. Close that app, then try again.";
    } else if (name === "SecurityError" || name === "NotSupportedError" || !window.isSecureContext) {
      msg = "The camera needs a secure page (https). Open this booth from its https link, or from localhost while testing.";
    } else if (name === "OverconstrainedError") {
      msg = "This camera could not start with the usual settings. Trying again with a simpler setting may help. Tap the shutter after a moment, or use Switch camera.";
    } else {
      msg = "The camera could not start. You can still see the board, and you can try again in a moment.";
    }
    return msg;
  }

  function showCamError(err) {
    camErrorEl.innerHTML = "<p>" + kindCamError(err) + "</p>";
    camErrorEl.classList.remove("hidden");
  }

  function hideCamError() {
    camErrorEl.classList.add("hidden");
    camErrorEl.innerHTML = "";
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      stream = null;
    }
    video.srcObject = null;
  }

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showCamError({ name: "NotSupportedError" });
      return Promise.resolve();
    }
    stopCamera();
    hideCamError();
    var constraints = {
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };
    return navigator.mediaDevices.getUserMedia(constraints).then(function (s) {
      stream = s;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.muted = true;
      video.autoplay = true;
      video.srcObject = s;
      var play = video.play();
      if (play && play.catch) play.catch(function () { /* autoplay can wait for a tap */ });
      return s;
    }).catch(function (err) {
      /* fallback without facingMode if overconstrained */
      if (err && err.name === "OverconstrainedError") {
        return navigator.mediaDevices.getUserMedia({ audio: false, video: true }).then(function (s) {
          stream = s;
          video.setAttribute("playsinline", "");
          video.setAttribute("webkit-playsinline", "");
          video.muted = true;
          video.srcObject = s;
          var play = video.play();
          if (play && play.catch) play.catch(function () {});
          return s;
        }).catch(function (err2) {
          showCamError(err2);
        });
      }
      showCamError(err);
    });
  }

  function playShutter() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      var len = Math.floor(ctx.sampleRate * 0.07);
      var buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      var i, env;
      for (i = 0; i < len; i++) {
        env = Math.exp(-i / (ctx.sampleRate * 0.018));
        data[i] = (Math.random() * 2 - 1) * env * 0.14;
      }
      var src = ctx.createBufferSource();
      src.buffer = buffer;
      var filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1600;
      var gain = ctx.createGain();
      gain.gain.value = 0.32;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start();
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 350);
    } catch (e) { /* ignore */ }
  }

  function captureStill() {
    var vw = video.videoWidth || 1280;
    var vh = video.videoHeight || 720;
    var tw = 848, th = 700;
    var srcAspect = vw / vh, destAspect = tw / th;
    var sx, sy, sw, sh;
    if (srcAspect > destAspect) {
      sh = vh;
      sw = vh * destAspect;
      sx = (vw - sw) / 2;
      sy = 0;
    } else {
      sw = vw;
      sh = vw / destAspect;
      sx = 0;
      sy = (vh - sh) / 2;
    }
    var c = document.createElement("canvas");
    c.width = tw;
    c.height = th;
    var ctx = c.getContext("2d");
    /* Preview is CSS-mirrored like a selfie. The saved still is un-mirrored (standard camera). */
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, tw, th);
    return new Promise(function (resolve) {
      c.toBlob(function (blob) { resolve(blob); }, "image/jpeg", 0.92);
    });
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function startCountdown() {
    if (busy) return;
    if (!stream) {
      startCamera().then(function () {
        if (stream) startCountdown();
      });
      return;
    }
    busy = true;
    shutterBtn.disabled = true;
    if (window.SalinCompliments) SalinCompliments.fresh();
    var n = 3;
    countdownEl.classList.remove("hidden");
    function tick() {
      if (n >= 1) {
        countdownEl.textContent = String(n);
        n -= 1;
        wait(800).then(tick);
      } else {
        countdownEl.textContent = "";
        countdownEl.classList.add("hidden");
        flashEl.classList.remove("on");
        void flashEl.offsetWidth;
        flashEl.classList.add("on");
        playShutter();
        if (window.SalinCompliments) SalinCompliments.flashShutter();
        captureStill().then(function (blob) {
          capturedBlob = blob;
          if (capturedUrl) URL.revokeObjectURL(capturedUrl);
          capturedUrl = URL.createObjectURL(blob);
          captionPreview.src = capturedUrl;
          captionInput.value = "";
          charCount.textContent = "0";
          showView("caption");
          stopCamera();
          busy = false;
          shutterBtn.disabled = false;
          setTimeout(function () { captionInput.focus(); }, 200);
        }).catch(function () {
          busy = false;
          shutterBtn.disabled = false;
        });
      }
    }
    tick();
  }

  function randomTilt() {
    return Math.round((Math.random() * 6 - 3) * 10) / 10;
  }

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function photoUrl(photo, field) {
    var blob = photo[field || "photo"] || photo.framed;
    return URL.createObjectURL(blob);
  }

  var tallestViewport = 0;

  function setAppHeight() {
    var vv = window.visualViewport;
    var h = (vv && vv.height) ? vv.height : window.innerHeight;
    var top = (vv && typeof vv.offsetTop === "number") ? vv.offsetTop : 0;
    if (h > tallestViewport) tallestViewport = h;
    document.documentElement.style.setProperty("--app-h", h + "px");
    document.documentElement.style.setProperty("--vv-top", top + "px");
    var open = currentView === "caption" && tallestViewport && h < tallestViewport * 0.8;
    document.body.classList.toggle("keyboard-open", !!open);
    layoutWall();
  }

  function layoutWall() {
    if (!boardScroll || !boardGrid) return;
    var gapY = parseFloat(getComputedStyle(boardGrid).rowGap) || 16;
    var cs = getComputedStyle(boardScroll);
    var pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    var gp = parseFloat(getComputedStyle(boardGrid).paddingTop) || 0;
    var gpB = parseFloat(getComputedStyle(boardGrid).paddingBottom) || 0;
    var h = boardScroll.clientHeight - pad;
    if (h < 80) return;
    var w = window.innerWidth;
    var visibleRows = 2;
    if (w <= 420) visibleRows = 1;
    else if (window.matchMedia("(orientation: portrait) and (min-height: 1100px)").matches) visibleRows = 3;
    var rowH = Math.floor((h - gp - gpB - gapY * (visibleRows - 1)) / visibleRows);
    if (rowH > 80) boardGrid.style.setProperty("--row-h", rowH + "px");
  }

  function bindViewport() {
    setAppHeight();
    window.addEventListener("resize", setAppHeight);
    window.addEventListener("orientationchange", function () { setTimeout(setAppHeight, 80); });
    if (window.visualViewport) {
      visualViewport.addEventListener("resize", setAppHeight);
      visualViewport.addEventListener("scroll", setAppHeight);
    }
  }

  function updateBoardEvent() {
    var el = $("board-event");
    if (!el) return Promise.resolve();
    return storage.getSettings().then(function (s) {
      var name = (s.eventName || "").trim();
      var date = s.eventDate ? storage.formatEventDate(s.eventDate) : "";
      el.textContent = [name, date].filter(Boolean).join(" · ");
    });
  }

  function renderBoard(opts) {
    opts = opts || {};
    updateBoardEvent();
    setTimeout(layoutWall, 0);
    return storage.getAllPhotos().then(function (photos) {
      photoCountCache = photos.length;
      boardGrid.innerHTML = "";
      if (!photos.length) {
        var empty = document.createElement("p");
        empty.className = "board-empty";
        empty.textContent = "The wall is ready for the first pin.";
        boardGrid.appendChild(empty);
        return photos;
      }
      photos.forEach(function (p) {
        var card = document.createElement("article");
        card.className = "pin-card";
        card.dataset.id = p.id;
        card.style.setProperty("--tilt", (p.tilt || 0) + "deg");
        if (opts.highlightId && p.id === opts.highlightId) card.classList.add("is-new");
        var pin = document.createElement("div");
        pin.className = "pin";
        pin.setAttribute("aria-hidden", "true");
        var img = document.createElement("img");
        img.className = "pin-photo";
        img.alt = "";
        img.src = photoUrl(p, "photo");
        var msg = document.createElement("div");
        msg.className = "pin-msg";
        msg.textContent = p.caption || "";
        card.appendChild(pin);
        card.appendChild(img);
        card.appendChild(msg);
        boardGrid.appendChild(card);
      });
      if (opts.highlightId) {
        setTimeout(function () {
          var el = boardGrid.querySelector('[data-id="' + opts.highlightId + '"]');
          if (el && boardScroll) {
            var top = el.offsetTop - Math.max(24, boardScroll.clientHeight / 4);
            boardScroll.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
          }
        }, 60);
      } else if (boardScroll) {
        boardScroll.scrollTop = 0;
      }
      requestAnimationFrame(function () {
        layoutWall();
        if (!opts.highlightId && boardScroll) boardScroll.scrollTop = 0;
      });
      return photos;
    });
  }

  function clearReturnTimer() {
    if (returnTimer) {
      clearInterval(returnTimer);
      returnTimer = null;
    }
    returnLeft = 0;
  }

  function goBooth() {
    clearReturnTimer();
    afterPin = false;
    justPinnedId = null;
    thanksBar.classList.add("hidden");
    backBoothBtn.classList.add("hidden");
    showView("booth");
    startCamera();
  }

  function goBoard(fromBrowse) {
    clearReturnTimer();
    showView("board");
    stopCamera();
    thanksBar.classList.toggle("hidden", !afterPin);
    backBoothBtn.classList.toggle("hidden", !!afterPin);
    renderBoard({ highlightId: justPinnedId }).then(function () {
      if (afterPin) startReturnCountdown();
    });
  }

  function startReturnCountdown() {
    clearReturnTimer();
    returnLeft = 6;
    var btn = $("btn-next");
    function tick() {
      if (returnLeft <= 0) {
        goBooth();
        return;
      }
      btn.textContent = "Next guest (" + returnLeft + ")";
      returnLeft -= 1;
    }
    tick();
    returnTimer = setInterval(tick, 1000);
  }

  function pinIt() {
    if (busy || !capturedBlob) return Promise.resolve(null);
    busy = true;
    $("btn-pin").disabled = true;
    var caption = String(captionInput.value || "").trim().slice(0, 80);
    var id = makeId();
    var createdAt = Date.now();
    var filename = "salin-" + id.replace(/[^a-zA-Z0-9_-]/g, "") + ".jpg";
    return storage.getSettings().then(function (settings) {
      var eventDate = settings.eventDate || storage.todayDate();
      return frame.compose({
        photo: capturedBlob,
        caption: caption,
        date: eventDate,
        eventDate: eventDate
      }).then(function (framed) {
        var photo = {
          id: id,
          filename: filename,
          caption: caption,
          createdAt: createdAt,
          dateLabel: frame.dateLabelFrom(eventDate),
          tilt: randomTilt(),
          photo: capturedBlob,
          framed: framed,
          isSample: false
        };
        /* Write to IndexedDB and verify the read-back BEFORE showing the pin. */
        return storage.addPhoto(photo).then(function () {
          return storage.getPhoto(id).then(function (saved) {
            if (!saved || !saved.framed) throw new Error("Save could not be verified");
            photoCountCache += 1;
            return backup.enqueuePhoto(photo).then(function () { return photo; });
          });
        });
      });
    }).then(function (photo) {
      justPinnedId = photo.id;
      afterPin = true;
      capturedBlob = null;
      busy = false;
      $("btn-pin").disabled = false;
      goBoard(false);
      refreshAdminCounts();
    }).catch(function (err) {
      busy = false;
      $("btn-pin").disabled = false;
      alert("Sorry, the photo could not be pinned. Please try again.");
    });
  }

  /* ---------- admin ---------- */
  function openPinModal() {
    pinBuffer = "";
    $("pin-msg").textContent = "";
    renderPinDots();
    $("pin-modal").classList.remove("hidden");
  }

  function closePinModal() {
    $("pin-modal").classList.add("hidden");
    pinBuffer = "";
  }

  function renderPinDots() {
    var wrap = $("pin-dots");
    wrap.innerHTML = "";
    var i, d;
    for (i = 0; i < 4; i++) {
      d = document.createElement("span");
      d.className = "pin-dot" + (i < pinBuffer.length ? " on" : "");
      wrap.appendChild(d);
    }
  }

  function buildPad() {
    var pad = $("pin-pad");
    pad.innerHTML = "";
    var keys = ["1","2","3","4","5","6","7","8","9","C","0","⌫"];
    keys.forEach(function (k) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = k;
      b.addEventListener("click", function () { onPad(k); });
      pad.appendChild(b);
    });
  }

  function onPad(k) {
    $("pin-msg").textContent = "";
    if (k === "C") { pinBuffer = ""; renderPinDots(); return; }
    if (k === "⌫") { pinBuffer = pinBuffer.slice(0, -1); renderPinDots(); return; }
    if (pinBuffer.length >= 8) return;
    pinBuffer += k;
    renderPinDots();
    if (pinBuffer.length >= 4) {
      storage.getSettings().then(function (s) {
        if (pinBuffer === String(s.pin || "1234")) {
          closePinModal();
          openAdmin();
        } else if (pinBuffer.length >= String(s.pin || "1234").length) {
          $("pin-msg").textContent = "That PIN is not right. Try again.";
          pinBuffer = "";
          renderPinDots();
        }
      });
    }
  }

  function formatClock(ts) {
    var d = new Date(ts);
    var h = d.getHours(), m = d.getMinutes();
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  function refreshAdminCounts() {
    return Promise.all([
      storage.countPhotos(),
      storage.countBackedUp(),
      storage.getSettings(),
      storage.countSinceExport()
    ]).then(function (quad) {
      var n = quad[0], m = quad[1], settings = quad[2], since = quad[3];
      photoCountCache = n;
      var saved = n === 1 ? "✓ 1 photo saved" : ("✓ " + n + " photos saved");
      var line = saved;
      if (settings.backupEnabled) {
        line = saved + " · " + m + " backed up ☁";
      }
      $("admin-count").textContent = line;
      var persistEl = $("admin-persist");
      if (persistEl) {
        persistEl.textContent = persistOk
          ? "Photos protected ✓"
          : "Add to Home Screen for best protection";
      }
      var lastEl = $("admin-last-backup");
      if (lastEl) {
        if (settings.lastExportAt) {
          lastEl.textContent = "Last backup: " + formatClock(settings.lastExportAt) + ", " + since + " since";
        } else {
          lastEl.textContent = n ? ("No export yet, " + n + " since") : "No export yet";
        }
      }
      var nudge = $("export-nudge");
      if (nudge) nudge.classList.toggle("hidden", since < 25);
      var err = settings.lastBackupError || backup.getLastError() || "";
      var errEl = $("admin-backup-error");
      if (err) {
        errEl.textContent = "Cloud backup: " + err;
        errEl.classList.remove("hidden");
      } else {
        errEl.classList.add("hidden");
        errEl.textContent = "";
      }
      return settings;
    });
  }

  function fillAdminForm(settings) {
    $("backup-url").value = settings.backupUrl || "";
    $("backup-secret").value = settings.backupSecret || "";
    $("event-name").value = settings.eventName || "";
    $("event-date").value = settings.eventDate || storage.todayDate();
    var on = !!settings.backupEnabled;
    $("backup-toggle").classList.toggle("on", on);
    $("backup-toggle").setAttribute("aria-pressed", on ? "true" : "false");
    $("backup-toggle-label").textContent = on
      ? "On — new photos back up silently to your Drive"
      : "Off — photos stay on this tablet only";
  }

  function renderAdminGrid(photos) {
    var grid = $("admin-grid");
    grid.innerHTML = "";
    photos.slice().reverse().forEach(function (p) {
      var fig = document.createElement("figure");
      fig.className = "admin-tile" + (pickMode && selectedIds[p.id] ? " picked" : "");
      fig.dataset.id = p.id;
      var img = document.createElement("img");
      img.alt = p.caption || "Photo";
      img.src = photoUrl(p, "photo");
      var cap = document.createElement("figcaption");
      cap.textContent = p.caption || "(no message)";
      fig.appendChild(img);
      fig.appendChild(cap);
      if (pickMode) {
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "tile-check";
        cb.checked = !!selectedIds[p.id];
        cb.addEventListener("change", function () {
          if (cb.checked) selectedIds[p.id] = true;
          else delete selectedIds[p.id];
          fig.classList.toggle("picked", cb.checked);
        });
        fig.appendChild(cb);
      } else {
        var actions = document.createElement("div");
        actions.className = "tile-actions";
        var del = document.createElement("button");
        del.type = "button";
        del.className = "btn btn-danger btn-block";
        del.textContent = "Delete";
        del.addEventListener("click", function () {
          if (!confirm("Delete this photo from the board and from this tablet?")) return;
          storage.deletePhoto(p.id).then(function () {
            return Promise.all([renderAdminGridRefresh(), renderBoard(), refreshAdminCounts()]);
          });
        });
        actions.appendChild(del);
        fig.appendChild(actions);
      }
      grid.appendChild(fig);
    });
  }

  function renderAdminGridRefresh() {
    return storage.getAllPhotos().then(renderAdminGrid);
  }

  function openAdmin() {
    pickMode = false;
    selectedIds = {};
    $("btn-export-picked").classList.add("hidden");
    $("pick-hint").classList.add("hidden");
    $("btn-pick").textContent = "Pick photos";
    $("test-msg").textContent = "";
    $("pin-save-msg").textContent = "";
    $("admin-modal").classList.remove("hidden");
    checkStorageHealth();
    storage.getSettings().then(function (s) {
      fillAdminForm(s);
      return Promise.all([storage.getAllPhotos(), refreshAdminCounts()]);
    }).then(function (pair) {
      renderAdminGrid(pair[0]);
    });
  }

  function closeAdmin() {
    $("admin-modal").classList.add("hidden");
    if (currentView === "board") renderBoard({ highlightId: justPinnedId });
  }

  function persistBackupFields() {
    return storage.setSettings({
      backupUrl: $("backup-url").value.trim(),
      backupSecret: $("backup-secret").value,
      eventName: $("event-name").value.trim(),
      eventDate: $("event-date").value
    });
  }

  function exportPhotos(photos) {
    if (!photos.length) {
      alert("There are no photos to export yet.");
      return;
    }
    var files = [];
    var lines = [];
    photos.forEach(function (p, i) {
      var name = p.filename || ("salin-" + String(i + 1).padStart(3, "0") + ".jpg");
      files.push({ name: name, data: p.framed || p.photo, date: new Date(p.createdAt) });
      lines.push(name + "\t" + (p.caption || "") + "\t" + (p.dateLabel || ""));
    });
    files.push({ name: "captions.txt", data: new Blob([lines.join("\n") + "\n"], { type: "text/plain" }) });
    return storage.getSettings().then(function (settings) {
      return zip.createZip(files).then(function (blob) {
        zip.downloadBlob(blob, storage.zipName(settings));
        return storage.setSettings({ lastExportAt: Date.now() }).then(function () {
          return refreshAdminCounts();
        });
      });
    });
  }

  function bindLongPress(el, fn) {
    var t = null;
    function start(e) {
      if (e.button && e.button !== 0) return;
      t = setTimeout(function () { t = null; fn(); }, 800);
    }
    function end() { if (t) { clearTimeout(t); t = null; } }
    el.addEventListener("pointerdown", start);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", end);
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  function wire() {
    buildPad();
    document.querySelectorAll(".js-logo").forEach(function (el) {
      bindLongPress(el, openPinModal);
    });

    shutterBtn.addEventListener("click", startCountdown);
    switchBtn.addEventListener("click", function () {
      facing = facing === "user" ? "environment" : "user";
      startCamera();
    });
    $("btn-see-board").addEventListener("click", function () {
      afterPin = false;
      justPinnedId = null;
      goBoard(true);
    });
    $("btn-retake").addEventListener("click", function () {
      capturedBlob = null;
      goBooth();
    });
    $("btn-pin").addEventListener("click", pinIt);
    captionInput.addEventListener("input", function () {
      var v = captionInput.value.slice(0, 80);
      if (v !== captionInput.value) captionInput.value = v;
      charCount.textContent = String(v.length);
    });
    $("btn-next").addEventListener("click", goBooth);
    backBoothBtn.addEventListener("click", goBooth);
    $("btn-pin-cancel").addEventListener("click", closePinModal);
    $("btn-admin-close").addEventListener("click", closeAdmin);

    $("btn-export-all").addEventListener("click", function () {
      storage.getAllPhotos().then(exportPhotos);
    });
    $("btn-pick").addEventListener("click", function () {
      pickMode = !pickMode;
      selectedIds = {};
      $("btn-export-picked").classList.toggle("hidden", !pickMode);
      $("pick-hint").classList.toggle("hidden", !pickMode);
      $("btn-pick").textContent = pickMode ? "Cancel pick" : "Pick photos";
      renderAdminGridRefresh();
    });
    $("btn-export-picked").addEventListener("click", function () {
      var ids = Object.keys(selectedIds);
      if (!ids.length) {
        alert("Tick one or more photos first.");
        return;
      }
      storage.getAllPhotos().then(function (all) {
        exportPhotos(all.filter(function (p) { return selectedIds[p.id]; }));
      });
    });
    $("btn-new-event").addEventListener("click", function () { openNewEvent(); });
    $("ne-cancel").addEventListener("click", closeNewEvent);
    $("ne-export-now").addEventListener("click", function () {
      storage.getAllPhotos().then(function (photos) {
        return exportPhotos(photos);
      }).then(function () { neGoStep("b"); });
    });
    $("ne-skip-export").addEventListener("click", function () { neGoStep("b"); });
    $("ne-clear-type").addEventListener("input", function () {
      var ok = String($("ne-clear-type").value || "").trim().toLowerCase() === "clear";
      $("ne-clear-wall").disabled = !ok;
    });
    $("ne-clear-wall").addEventListener("click", function () {
      if ($("ne-clear-wall").disabled) return;
      neGoStep("d");
    });
    $("ne-start").addEventListener("click", finishNewEvent);
    $("btn-setup-tips").addEventListener("click", function () {
      $("setup-modal").classList.remove("hidden");
    });
    $("btn-setup-close").addEventListener("click", function () {
      $("setup-modal").classList.add("hidden");
    });

    $("backup-toggle").addEventListener("click", function () {
      persistBackupFields().then(function () {
        return storage.getSettings();
      }).then(function (s) {
        var on = !s.backupEnabled;
        return storage.setSettings({ backupEnabled: on }).then(function (next) {
          fillAdminForm(next);
          if (on) {
            return backup.enqueueMissing().then(function () { backup.kick(200); });
          }
        });
      }).then(refreshAdminCounts);
    });

    ["backup-url", "backup-secret", "event-name", "event-date"].forEach(function (id) {
      $(id).addEventListener("change", persistBackupFields);
    });

    $("btn-test").addEventListener("click", function () {
      var msg = $("test-msg");
      msg.className = "test-msg";
      msg.textContent = "Testing…";
      persistBackupFields().then(function (s) {
        return backup.testConnection(s.backupUrl, s.backupSecret, s.eventName, s.eventDate);
      }).then(function () {
        msg.className = "test-msg good";
        msg.textContent = "Connection works. New photos can back up silently.";
      }).catch(function (err) {
        msg.className = "test-msg bad";
        msg.textContent = (err && err.message) ? err.message : "Test failed.";
      });
    });

    $("btn-save-pin").addEventListener("click", function () {
      var v = String($("new-pin").value || "").trim();
      var out = $("pin-save-msg");
      if (!/^\d{4,8}$/.test(v)) {
        out.className = "test-msg bad";
        out.textContent = "Use 4 to 8 digits.";
        return;
      }
      storage.setSettings({ pin: v }).then(function () {
        $("new-pin").value = "";
        out.className = "test-msg good";
        out.textContent = "PIN saved on this tablet only.";
      });
    });

    backup.onChange(function () {
      if (!$("admin-modal").classList.contains("hidden")) refreshAdminCounts();
    });
  }

  /* ---------- sample seed + QA hooks ---------- */
  var SAMPLE_CAPTIONS = [
    "Sample: I'm lovin Salin!",
    "Sample: Best day ever!",
    "Sample: Smells so good!",
    "Sample: Congrats from us!",
    "Sample: See you next event!",
    "Sample: Squad goals!",
    "Sample: Thank you, SALIN!",
    "Sample: Love this booth!",
    "Sample: Eco souvenirs!",
    "Sample: Tagum memories!",
    "Sample: So much fun!",
    "Sample: Pin it!"
  ];

  function fetchBlob(url) {
    return fetch(url).then(function (r) { return r.blob(); });
  }

  function seedSamples() {
    return storage.getAllPhotos().then(function (existing) {
      if (existing && existing.length) return existing;
      var jobs = [];
      var i;
      for (i = 1; i <= 12; i++) {
        jobs.push((function (n) {
          var src = "samples/sample-" + (n < 10 ? "0" : "") + n + ".jpg";
          return fetchBlob(src).then(function (blob) {
            return storage.getSettings().then(function (s) {
              var eventDate = s.eventDate || storage.todayDate();
              return frame.compose({ photo: blob, caption: SAMPLE_CAPTIONS[n - 1], date: eventDate, eventDate: eventDate }).then(function (framed) {
                return { framed: framed, eventDate: eventDate };
              });
            }).then(function (pack) {
              var framed = pack.framed, eventDate = pack.eventDate;
              var id = "sample-" + (n < 10 ? "0" : "") + n;
              var photo = {
                id: id,
                filename: id + ".jpg",
                caption: SAMPLE_CAPTIONS[n - 1],
                createdAt: Date.now() - (12 - n) * 1000,
                dateLabel: frame.dateLabelFrom(eventDate),
                tilt: Math.round((Math.random() * 6 - 3) * 10) / 10,
                photo: blob,
                framed: framed,
                isSample: true
              };
              return storage.addPhoto(photo).then(function () { return photo; });
            });
          });
        })(i));
      }
      return Promise.all(jobs);
    });
  }

  window.__salinQA = {
    goBooth: goBooth,
    goCaption: function (text) {
      if (text) {
        captionInput.value = text.slice(0, 80);
        charCount.textContent = String(captionInput.value.length);
      }
      showView("caption");
    },
    goBoard: function (opts) {
      opts = opts || {};
      afterPin = !!opts.thankYou;
      if (Object.prototype.hasOwnProperty.call(opts, "highlightId")) {
        justPinnedId = opts.highlightId;
      }
      showView("board");
      thanksBar.classList.toggle("hidden", !afterPin);
      backBoothBtn.classList.toggle("hidden", !!afterPin);
      return renderBoard({ highlightId: justPinnedId });
    },
    openAdmin: openAdmin,
    closeAdmin: closeAdmin,
    openPin: openPinModal,
    seedSamples: seedSamples,
    counts: function () {
      return Promise.all([storage.countPhotos(), storage.countBackedUp(), storage.listQueue(), storage.getSettings()]);
    },
    setCapturedFromUrl: function (url) {
      return fetchBlob(url).then(function (blob) {
        capturedBlob = blob;
        if (capturedUrl) URL.revokeObjectURL(capturedUrl);
        capturedUrl = URL.createObjectURL(blob);
        captionPreview.src = capturedUrl;
        return blob;
      });
    },
    pinIt: pinIt,
    getCaptured: function () { return capturedBlob; },
    setCompliment: function (line) {
      if (window.SalinCompliments) SalinCompliments.showLine(line);
    },
    setFaceCount: function (n, smile) {
      if (window.SalinCompliments) SalinCompliments.setFaceCount(n, smile);
    },
    complimentState: function () {
      return window.SalinCompliments ? SalinCompliments.getState() : null;
    },
    openNewEvent: function () { return openNewEvent(); },
    closeNewEvent: function () { closeNewEvent(); },
    newEventStep: function (step) { neGoStep(step); },
    openSetupTips: function () { $("setup-modal").classList.remove("hidden"); },
    closeSetupTips: function () { $("setup-modal").classList.add("hidden"); },
    persistStatus: function () { return persistOk; },
    photoCount: function () { return storage.countPhotos(); },
    simulateKeyboard: function (on) {
      if (on) {
        tallestViewport = Math.max(tallestViewport, window.innerHeight);
        document.body.classList.add("keyboard-open");
        var h = Math.round((window.visualViewport ? visualViewport.height : window.innerHeight) * 0.6);
        document.documentElement.style.setProperty("--app-h", h + "px");
      } else {
        document.body.classList.remove("keyboard-open");
        setAppHeight();
      }
    },
    layoutWall: layoutWall
  };

  /* ---------- new event wizard ---------- */
  function neGoStep(step) {
    ["a", "b", "c", "d"].forEach(function (s) {
      $("ne-step-" + s).classList.toggle("hidden", s !== step);
    });
    if (step === "b") {
      nePinBuffer = "";
      $("ne-pin-msg").textContent = "";
      renderNePinDots();
    }
    if (step === "d") {
      $("ne-event-date").value = storage.todayDate();
      storage.getSettings().then(function (s) {
        $("ne-event-name").value = s.eventName || "";
        /* date still defaults to today for a new event */
      });
    }
  }

  function renderNePinDots() {
    var wrap = $("ne-pin-dots");
    if (!wrap) return;
    wrap.innerHTML = "";
    var i, d;
    for (i = 0; i < 4; i++) {
      d = document.createElement("span");
      d.className = "pin-dot" + (i < nePinBuffer.length ? " on" : "");
      wrap.appendChild(d);
    }
  }

  function buildNePad() {
    var pad = $("ne-pin-pad");
    if (!pad || pad.getAttribute("data-ready")) return;
    pad.setAttribute("data-ready", "1");
    ["1","2","3","4","5","6","7","8","9","C","0","⌫"].forEach(function (k) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = k;
      b.addEventListener("click", function () { onNePad(k); });
      pad.appendChild(b);
    });
  }

  function onNePad(k) {
    $("ne-pin-msg").textContent = "";
    if (k === "C") { nePinBuffer = ""; renderNePinDots(); return; }
    if (k === "⌫") { nePinBuffer = nePinBuffer.slice(0, -1); renderNePinDots(); return; }
    if (nePinBuffer.length >= 8) return;
    nePinBuffer += k;
    renderNePinDots();
    if (nePinBuffer.length >= 4) {
      storage.getSettings().then(function (s) {
        if (nePinBuffer === String(s.pin || "1234")) {
          neGoStep("c");
        } else if (nePinBuffer.length >= String(s.pin || "1234").length) {
          $("ne-pin-msg").textContent = "That PIN is not right. Try again.";
          nePinBuffer = "";
          renderNePinDots();
        }
      });
    }
  }

  function openNewEvent() {
    buildNePad();
    $("ne-clear-type").value = "";
    $("ne-clear-wall").disabled = true;
    storage.countPhotos().then(function (n) {
      $("ne-export-copy").textContent = "Did you export this event's photos?";
      $("ne-export-count").textContent = n === 1 ? "1 photo is on this tablet." : (n + " photos are on this tablet.");
      neGoStep("a");
      $("newevent-modal").classList.remove("hidden");
    });
  }

  function closeNewEvent() {
    $("newevent-modal").classList.add("hidden");
  }

  function finishNewEvent() {
    var name = String($("ne-event-name").value || "").trim();
    var date = $("ne-event-date").value || storage.todayDate();
    /* Wipe photos and the backup queue in IndexedDB only — not the service worker cache. */
    storage.clearPhotos().then(function () {
      photoCountCache = 0;
      selectedIds = {};
      justPinnedId = null;
      afterPin = false;
      return storage.setSettings({
        eventName: name,
        eventDate: date,
        lastExportAt: 0,
        lastBackupError: ""
      });
    }).then(function () {
      if ($("event-name")) $("event-name").value = name;
      if ($("event-date")) $("event-date").value = date;
      closeNewEvent();
      closeAdmin();
      return Promise.all([renderBoard(), updateBoardEvent(), refreshAdminCounts()]);
    }).then(function () {
      goBoard(true);
    });
  }

  function requestPersist() {
    if (!navigator.storage || !navigator.storage.persist) {
      persistOk = false;
      return Promise.resolve(false);
    }
    return navigator.storage.persist().then(function (ok) {
      persistOk = !!ok;
      if (!ok && navigator.storage.persisted) {
        return navigator.storage.persisted().then(function (already) {
          persistOk = !!already;
          return persistOk;
        });
      }
      return persistOk;
    }).catch(function () {
      persistOk = false;
      return false;
    });
  }

  function checkStorageHealth() {
    var warn = $("host-warn");
    if (!warn) return;
    var messages = [];
    var checks = [];
    if (!window.indexedDB) {
      messages.push("IndexedDB is not available. Photos cannot be saved in this browser. Avoid private or incognito tabs.");
    }
    if (navigator.storage && navigator.storage.estimate) {
      checks.push(navigator.storage.estimate().then(function (est) {
        var quota = Number(est && est.quota) || 0;
        var usage = Number(est && est.usage) || 0;
        if (quota && quota < 50 * 1024 * 1024) {
          messages.push("Storage space for this site looks very small (often a private tab). Open the booth in a regular browser and add it to the Home Screen.");
        } else if (quota && usage / quota > 0.85) {
          messages.push("Storage is nearly full. Export the photos, then you can start a new event.");
        }
      }).catch(function () {}));
    }
    return Promise.all(checks).then(function () {
      if (messages.length) {
        warn.textContent = messages.join(" ");
        warn.classList.remove("hidden");
      } else {
        warn.textContent = "";
        warn.classList.add("hidden");
      }
    });
  }

  function bindBeforeUnload() {
    window.addEventListener("beforeunload", function (e) {
      if (location.search.indexOf("qa=1") !== -1) return;
      if (photoCountCache > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  function boot() {
    wire();
    buildNePad();
    bindViewport();
    frame.ready().catch(function () {});
    bindBeforeUnload();
    storage.init().then(function () {
      return storage.countPhotos().then(function (n) {
        photoCountCache = n;
        backup.start();
        requestPersist().then(function () { refreshAdminCounts(); });
        checkStorageHealth();
        showView("booth");
        if (location.search.indexOf("qa=1") === -1) startCamera();
      });
    }).catch(function () {
      persistOk = false;
      checkStorageHealth();
      showView("booth");
    });
    if ("serviceWorker" in navigator && location.search.indexOf("qa=1") === -1) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  boot();
})();
