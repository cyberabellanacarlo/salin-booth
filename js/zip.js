/* Minimal ZIP (STORE / uncompressed). JPEGs barely shrink, and this works in iPad Safari. */
(function (global) {
  "use strict";

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256), n, c, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xFFFFFFFF, i;
    for (i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function strToDos(str) {
    var i, c, out = [];
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else {
        /* UTF-8 */
        var enc = unescape(encodeURIComponent(str[i]));
        var j;
        for (j = 0; j < enc.length; j++) out.push(enc.charCodeAt(j) & 0xFF);
      }
    }
    return new Uint8Array(out);
  }

  function u16(n) { return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]); }
  function u32(n) {
    return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]);
  }

  function concat(parts) {
    var len = 0, i, offset, out;
    for (i = 0; i < parts.length; i++) len += parts[i].length;
    out = new Uint8Array(len);
    offset = 0;
    for (i = 0; i < parts.length; i++) {
      out.set(parts[i], offset);
      offset += parts[i].length;
    }
    return out;
  }

  function dosTime(date) {
    var d = date || new Date();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time, date: day };
  }

  /**
   * @param {Array<{name:string, data:Uint8Array|ArrayBuffer|Blob, date?:Date}>} files
   * @returns {Promise<Blob>}
   */
  function createZip(files) {
    var prepared = files.map(function (f) {
      return Promise.resolve(f.data).then(function (data) {
        if (data instanceof Blob) return data.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
        if (data instanceof ArrayBuffer) return new Uint8Array(data);
        return data;
      }).then(function (u8) {
        return { name: f.name, data: u8, date: f.date };
      });
    });
    return Promise.all(prepared).then(function (list) {
      var locals = [];
      var centrals = [];
      var offset = 0;
      var i, nameBytes, crc, size, when, local, central, flags;
      for (i = 0; i < list.length; i++) {
        nameBytes = strToDos(list[i].name);
        flags = 0x0800; /* UTF-8 names */
        crc = crc32(list[i].data);
        size = list[i].data.length;
        when = dosTime(list[i].date);
        local = concat([
          u32(0x04034b50),
          u16(20),
          u16(flags),
          u16(0),
          u16(when.time),
          u16(when.date),
          u32(crc),
          u32(size),
          u32(size),
          u16(nameBytes.length),
          u16(0),
          nameBytes,
          list[i].data
        ]);
        central = concat([
          u32(0x02014b50),
          u16(20),
          u16(20),
          u16(flags),
          u16(0),
          u16(when.time),
          u16(when.date),
          u32(crc),
          u32(size),
          u32(size),
          u16(nameBytes.length),
          u16(0),
          u16(0),
          u16(0),
          u16(0),
          u32(0),
          u32(offset),
          nameBytes
        ]);
        locals.push(local);
        centrals.push(central);
        offset += local.length;
      }
      var centralBlob = concat(centrals);
      var eocd = concat([
        u32(0x06054b50),
        u16(0),
        u16(0),
        u16(list.length),
        u16(list.length),
        u32(centralBlob.length),
        u32(offset),
        u16(0)
      ]);
      return new Blob([concat(locals.concat([centralBlob, eocd]))], { type: "application/zip" });
    });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  global.SalinZip = { createZip: createZip, downloadBlob: downloadBlob };
})(window);
