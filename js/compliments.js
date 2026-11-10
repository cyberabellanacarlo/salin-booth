/* Live booth compliments. On-device face detection via bundled MediaPipe (no CDN).
   Overlay only — never drawn into the saved souvenir photo. */
(function (global) {
  "use strict";

  var POOLS = {
    solo: [
      "Main character energy ✨",
      "Slaying, no cap",
      "Serving looks fr",
      "Giving cover star",
      "You're serving looks rn",
      "Slay. Just slay.",
      "That fit? Immaculate."
    ],
    duo: [
      "Duo goals unlocked 💚",
      "Certified besties",
      "The duo of the night",
      "Duo of the year fr",
      "Iconic duo alert 💚",
      "Besties with elite energy"
    ],
    group: [
      "Squad goals unlocked 🎉",
      "The whole squad ate",
      "Iconic crew alert 🎉",
      "The whole crew is a vibe",
      "Main cast energy, all of you"
    ],
    smile: [
      "That smile? Elite.",
      "Okay, we stan that smile",
      "That smile? Unmatched.",
      "Okay, that grin is 10/10",
      "Smiling like you won the raffle"
    ],
    none: [
      "Step in, bestie 📸",
      "Come closer, star ⭐",
      "The camera's ready for its star"
    ]
  };

  var SHUTTER_LINE = "Slay! 📸";
  var INTERVAL_MIN = 3000;
  var INTERVAL_MAX = 4000;
  var DETECT_EVERY = 200; /* ~5 fps */
  var SMILE_THRESHOLD = 0.42;

  var bubble = null;
  var textEl = null;
  var video = null;
  var lastLine = "";
  var mode = "none"; /* landmarker | detector | none */
  var landmarker = null;
  var detector = null;
  var faceCount = 0;
  var smiling = false;
  var running = false;
  var loadPromise = null;
  var rotateTimer = null;
  var detectTimer = null;
  var lastTs = -1;
  var frozen = false; /* true during shutter flash */

  function $(id) { return document.getElementById(id); }

  function pick(pool) {
    var list = pool.filter(function (s) { return s !== lastLine; });
    if (!list.length) list = pool.slice();
    var line = list[Math.floor(Math.random() * list.length)];
    lastLine = line;
    return line;
  }

  function currentPoolName() {
    if (mode === "none") return "solo";
    if (faceCount <= 0) return "none";
    if (smiling && mode === "landmarker") return "smile";
    if (faceCount === 1) return "solo";
    if (faceCount === 2) return "duo";
    return "group";
  }

  function fitText() {
    if (!bubble || !textEl) return;
    textEl.style.fontSize = "";
    bubble.style.whiteSpace = "nowrap";
    var size = 32;
    var min = 28;
    textEl.style.fontSize = size + "px";
    var safety = 0;
    while (safety < 20 && size > min && textEl.scrollWidth > bubble.clientWidth - 8) {
      size -= 1;
      textEl.style.fontSize = size + "px";
      safety += 1;
    }
    if (textEl.scrollWidth > bubble.clientWidth - 8) {
      /* still too long: wrap on spaces only, never mid-word */
      bubble.style.whiteSpace = "normal";
    }
  }

  function setVisible(on) {
    if (!bubble) return;
    if (on) bubble.classList.add("show");
    else bubble.classList.remove("show");
  }

  function showLine(line, instant) {
    if (!bubble || !textEl) return;
    lastLine = line;
    function apply() {
      textEl.textContent = line;
      fitText();
      setVisible(true);
    }
    if (instant) {
      apply();
      return;
    }
    setVisible(false);
    setTimeout(apply, 280);
  }

  function rotate() {
    if (!running || frozen) return;
    showLine(pick(POOLS[currentPoolName()]));
    scheduleRotate();
  }

  function scheduleRotate() {
    if (rotateTimer) clearTimeout(rotateTimer);
    var wait = INTERVAL_MIN + Math.random() * (INTERVAL_MAX - INTERVAL_MIN);
    rotateTimer = setTimeout(rotate, wait);
  }

  function fresh() {
    if (!running && !bubble) return;
    frozen = false;
    showLine(pick(POOLS[currentPoolName()]), true);
    scheduleRotate();
  }

  function flashShutter() {
    if (!bubble) return;
    frozen = true;
    if (rotateTimer) clearTimeout(rotateTimer);
    showLine(SHUTTER_LINE, true);
    setTimeout(function () {
      frozen = false;
      if (running) {
        showLine(pick(POOLS[currentPoolName()]));
        scheduleRotate();
      }
    }, 1200);
  }

  function blendshapeScore(shapes, name) {
    if (!shapes) return 0;
    var i, cat = shapes.categories || shapes;
    if (!cat || !cat.length) return 0;
    for (i = 0; i < cat.length; i++) {
      if (cat[i].categoryName === name || cat[i].displayName === name) {
        return Number(cat[i].score) || 0;
      }
    }
    return 0;
  }

  function readResult(result) {
    if (!result) {
      faceCount = 0;
      smiling = false;
      return;
    }
    var faces = result.faceLandmarks || result.detections || result.faces || [];
    faceCount = faces.length || 0;
    smiling = false;
    if (mode === "landmarker" && result.faceBlendshapes && result.faceBlendshapes.length) {
      var i, left, right, any = false;
      for (i = 0; i < result.faceBlendshapes.length; i++) {
        left = blendshapeScore(result.faceBlendshapes[i], "mouthSmileLeft");
        right = blendshapeScore(result.faceBlendshapes[i], "mouthSmileRight");
        if ((left + right) / 2 >= SMILE_THRESHOLD) any = true;
      }
      smiling = any;
    }
  }

  function tickDetect() {
    if (!running || !video) return;
    if (!video.videoWidth || video.readyState < 2) return;
    var ts = performance.now();
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;
    try {
      if (mode === "landmarker" && landmarker) {
        readResult(landmarker.detectForVideo(video, ts));
      } else if (mode === "detector" && detector) {
        readResult(detector.detectForVideo(video, ts));
      }
    } catch (err) {
      /* skip a frame; do not stall the booth */
    }
  }

  function startDetectLoop() {
    if (detectTimer) clearInterval(detectTimer);
    if (mode === "none") return;
    lastTs = -1;
    detectTimer = setInterval(tickDetect, DETECT_EVERY);
  }

  function loadModels() {
    if (loadPromise) return loadPromise;
    var here = document.baseURI || location.href;
    var bundleUrl = new URL("assets/mediapipe/vision_bundle.mjs", here).href;
    var wasmUrl = new URL("assets/mediapipe/wasm", here).href;
    var landUrl = new URL("assets/mediapipe/face_landmarker.task", here).href;
    var detUrl = new URL("assets/mediapipe/blaze_face_short_range.tflite", here).href;
    loadPromise = import(bundleUrl).then(function (vis) {
      return vis.FilesetResolver.forVisionTasks(wasmUrl).then(function (fileset) {
        return vis.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: landUrl },
          runningMode: "VIDEO",
          numFaces: 8,
          outputFaceBlendshapes: true
        }).then(function (lm) {
          landmarker = lm;
          mode = "landmarker";
          return "landmarker";
        }).catch(function () {
          return vis.FaceDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: detUrl },
            runningMode: "VIDEO"
          }).then(function (det) {
            detector = det;
            mode = "detector";
            return "detector";
          });
        });
      });
    }).catch(function () {
      mode = "none";
      landmarker = null;
      detector = null;
      return "none";
    });
    return loadPromise;
  }

  function attach() {
    bubble = $("compliment");
    textEl = $("compliment-text");
    video = $("cam");
  }

  function start() {
    attach();
    running = true;
    frozen = false;
    loadModels().then(function () {
      if (!running) return;
      startDetectLoop();
      if (!textEl || !textEl.textContent) fresh();
      else scheduleRotate();
    });
    /* show a line immediately (solo pool until models load) */
    if (textEl && !textEl.textContent) fresh();
  }

  function stop() {
    running = false;
    frozen = false;
    if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; }
    if (detectTimer) { clearInterval(detectTimer); detectTimer = null; }
    setVisible(false);
  }

  global.SalinCompliments = {
    start: start,
    stop: stop,
    fresh: fresh,
    flashShutter: flashShutter,
    showLine: function (line) { showLine(line, true); },
    setFaceCount: function (n, smile) {
      faceCount = n;
      smiling = !!smile;
    },
    getMode: function () { return mode; },
    getState: function () {
      return { mode: mode, faceCount: faceCount, smiling: smiling, line: lastLine, running: running };
    },
    loadModels: loadModels,
    pools: POOLS
  };
})(window);
