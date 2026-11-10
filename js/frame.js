/* Composite a guest photo into Kirby's SALIN instant-photo frame (1080x1350). */
(function (global) {
  "use strict";

  var W = 1080;
  var H = 1350;
  var readyPromise = null;
  var assets = { logo: null, flowerTr: null, flowerBl: null };

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("Could not load " + src)); };
      img.src = src;
    });
  }

  function loadFonts() {
    var faces = [
      new FontFace("Kalam", "url(assets/fonts/Kalam-Bold.ttf)", { weight: "700", style: "normal" }),
      new FontFace("Cormorant Garamond", "url(assets/fonts/CormorantGaramond.ttf)", { weight: "400", style: "normal" }),
      new FontFace("Cormorant Garamond", "url(assets/fonts/CormorantGaramond.ttf)", { weight: "600", style: "normal" }),
      new FontFace("Cormorant Garamond", "url(assets/fonts/CormorantGaramond-Italic.ttf)", { weight: "400", style: "italic" })
    ];
    return Promise.all(faces.map(function (f) {
      return f.load().then(function (loaded) {
        document.fonts.add(loaded);
        return loaded;
      });
    }));
  }

  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = Promise.all([
      loadFonts(),
      loadImage("assets/logo.png"),
      loadImage("assets/flower_tr.png"),
      loadImage("assets/flower_bl.png")
    ]).then(function (res) {
      assets.logo = res[1];
      assets.flowerTr = res[2];
      assets.flowerBl = res[3];
    });
    return readyPromise;
  }

  function drawSpacedText(ctx, text, x, y, spacing, align) {
    var i, total = 0, widths = [];
    for (i = 0; i < text.length; i++) {
      widths[i] = ctx.measureText(text.charAt(i)).width;
      total += widths[i];
    }
    if (text.length > 1) total += spacing * (text.length - 1);
    var cx = x;
    if (align === "center") cx = x - total / 2;
    if (align === "right") cx = x - total;
    for (i = 0; i < text.length; i++) {
      ctx.fillText(text.charAt(i), cx, y);
      cx += widths[i] + spacing;
    }
    return total;
  }

  function wrapLines(ctx, text, maxWidth) {
    var words = String(text || "").trim().split(/\s+/);
    var lines = [];
    var i, line = "", test;
    if (!words[0]) return [];
    for (i = 0; i < words.length; i++) {
      test = line ? line + " " + words[i] : words[i];
      if (ctx.measureText(test).width <= maxWidth) {
        line = test;
      } else {
        if (line) lines.push(line);
        if (ctx.measureText(words[i]).width <= maxWidth) {
          line = words[i];
        } else {
          /* hard-break a long token */
          var buf = "", ch, j;
          for (j = 0; j < words[i].length; j++) {
            ch = buf + words[i].charAt(j);
            if (buf && ctx.measureText(ch).width > maxWidth) {
              lines.push(buf);
              buf = words[i].charAt(j);
            } else buf = ch;
          }
          line = buf;
        }
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function layoutMessage(ctx, text, maxWidth) {
    var size, lines;
    for (size = 84; size >= 44; size -= 2) {
      ctx.font = "700 " + size + "px Kalam";
      lines = wrapLines(ctx, text, maxWidth);
      if (lines.length <= (size >= 70 ? 2 : 3)) {
        return { size: size, lines: lines };
      }
    }
    ctx.font = "700 44px Kalam";
    return { size: 44, lines: wrapLines(ctx, text, maxWidth).slice(0, 3) };
  }

  function roundedRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function dateLabelFrom(date) {
    /* Accept a Date, timestamp, or YYYY-MM-DD event date. */
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date)) {
      var p = date.split("-");
      return months[Number(p[1]) - 1] + " " + Number(p[2]) + ", " + p[0];
    }
    var d = date instanceof Date ? date : new Date(date || Date.now());
    return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  function loadPhoto(src) {
    if (src instanceof HTMLImageElement) return Promise.resolve(src);
    if (typeof src === "string") return loadImage(src);
    var url = URL.createObjectURL(src);
    return loadImage(url).then(function (img) {
      URL.revokeObjectURL(url);
      return img;
    }, function (err) {
      URL.revokeObjectURL(url);
      throw err;
    });
  }

  function coverDraw(ctx, img, x, y, w, h) {
    var ia = img.width / img.height;
    var ba = w / h;
    var sw, sh, sx, sy;
    if (ia > ba) {
      sh = img.height;
      sw = img.height * ba;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = img.width / ba;
      sx = 0;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  /**
   * @param {{photo: Blob|HTMLImageElement|string, caption: string, date?: Date|number}} opts
   * @returns {Promise<Blob>} framed JPEG
   */
  function compose(opts) {
    return ready().then(function () {
      return loadPhoto(opts.photo);
    }).then(function (photo) {
      var canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      var ctx = canvas.getContext("2d");

      /* cream page */
      ctx.fillStyle = "#F1ECE2";
      ctx.fillRect(0, 0, W, H);

      /* flowers (multiply), drawn first so the card can sit above the mid-page */
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      /* flower_tr: right:-10, top:-10, width 230 */
      var trW = 230;
      var trH = assets.flowerTr.height * (trW / assets.flowerTr.width);
      ctx.drawImage(assets.flowerTr, W - trW + 10, -10, trW, trH);
      /* flower_bl: left:-10, bottom:120, width 270 */
      var blW = 270;
      var blH = assets.flowerBl.height * (blW / assets.flowerBl.width);
      ctx.drawImage(assets.flowerBl, -10, H - 120 - blH, blW, blH);
      ctx.restore();

      /* header labels */
      ctx.fillStyle = "#3E4A33";
      ctx.font = "400 30px 'Cormorant Garamond'";
      ctx.textBaseline = "top";
      drawSpacedText(ctx, "SOUVENIR ALBUM", 70, 60, 8, "left");

      /* Event date sits directly under SOUVENIR ALBUM (no static side date). */
      ctx.fillStyle = "#8A7A5C";
      ctx.font = "italic 28px 'Cormorant Garamond'";
      drawSpacedText(ctx, dateLabelFrom(opts.eventDate || opts.date), 70, 98, 4, "left");

      /* card is rotated -1.2deg around its center */
      var cardX = 70, cardY = 150, cardW = 940, cardH = 1000;
      var cx = cardX + cardW / 2, cy = cardY + cardH / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-1.2 * Math.PI / 180);
      ctx.translate(-cx, -cy);

      /* shadow */
      ctx.save();
      ctx.shadowColor = "rgba(60,55,40,0.18)";
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 18;
      roundedRect(ctx, cardX, cardY, cardW, cardH, 6);
      ctx.fillStyle = "#FBF9F4";
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.shadowColor = "rgba(60,55,40,0.12)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      roundedRect(ctx, cardX, cardY, cardW, cardH, 6);
      ctx.fillStyle = "#FBF9F4";
      ctx.fill();
      ctx.restore();

      /* photo well 46,46 848x700 */
      var px = cardX + 46, py = cardY + 46, pw = 848, ph = 700;
      roundedRect(ctx, px, py, pw, ph, 2);
      ctx.save();
      ctx.clip();
      coverDraw(ctx, photo, px, py, pw, ph);
      ctx.restore();

      /* caption */
      var caption = String(opts.caption || "").trim();
      if (caption) {
        var maxW = cardW - 80;
        var layout = layoutMessage(ctx, caption, maxW);
        ctx.font = "700 " + layout.size + "px Kalam";
        ctx.fillStyle = "#2F3A26";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        var lineH = layout.size * 1.1;
        var blockH = layout.lines.length * lineH;
        var textTop = cardY + 770;
        /* if more than one line, keep it in the lower band */
        if (layout.lines.length > 1) {
          textTop = cardY + 758;
        }
        var i;
        for (i = 0; i < layout.lines.length; i++) {
          ctx.fillText(layout.lines[i], cx, textTop + i * lineH);
        }
        /* gold underline */
        var ulW = Math.max(180, Math.min(440, 40 + layout.lines[layout.lines.length - 1].length * layout.size * 0.42));
        var ulY = textTop + blockH + 8;
        ctx.save();
        ctx.translate(cx, ulY + 5);
        ctx.rotate(-2 * Math.PI / 180);
        roundedRect(ctx, -ulW / 2, -5, ulW, 10, 6);
        ctx.fillStyle = "#B08D57";
        ctx.fill();
        ctx.restore();
        ctx.textAlign = "left";
      }
      ctx.restore(); /* end card rotation */

      /* footer logo + tag — sit on the page, not on the rotated card */
      var logoH = 110;
      var logoW = assets.logo.width * (logoH / assets.logo.height);
      var logoX = (W - logoW) / 2;
      var logoY = H - 46 - logoH - 36;
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(assets.logo, logoX, logoY, logoW, logoH);
      ctx.restore();

      ctx.fillStyle = "#3E4A33";
      ctx.font = "400 26px 'Cormorant Garamond'";
      ctx.textBaseline = "top";
      drawSpacedText(ctx, "SUSTAINABLE · IMMERSIVE · MEMORABLE", W / 2, logoY + logoH + 4, 6, "center");

      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob); }, "image/jpeg", 0.9);
      });
    });
  }

  global.SalinFrame = {
    ready: ready,
    compose: compose,
    dateLabelFrom: dateLabelFrom,
    WIDTH: W,
    HEIGHT: H
  };
})(window);
