/**
 * SALIN Souvenir Booth — Google Drive backup
 *
 * Paste this file into a new project at script.google.com (Carlo's Google account).
 * Then follow the steps in SALIN-Drive-Setup.md.
 *
 * Deploy as:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * The booth sends a text/plain POST (not application/json) so browsers
 * skip the CORS preflight. Read the body from e.postData.contents.
 */

function setup() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty('SECRET');
  if (existing) {
    Logger.log('========================================');
    Logger.log('A secret already exists. It was left unchanged.');
    Logger.log('Your SALIN backup secret is:');
    Logger.log(existing);
    Logger.log('========================================');
    Logger.log('Copy that whole line into Host Admin → Cloud backup → Secret.');
    Logger.log('If you want a NEW secret, run the resetSecret function instead, then update the booth.');
    return;
  }
  resetSecret();
}

function resetSecret() {
  var secret = Utilities.getUuid() + '-' + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('SECRET', secret);
  Logger.log('========================================');
  Logger.log('Your SALIN backup secret is:');
  Logger.log(secret);
  Logger.log('========================================');
  Logger.log('Copy this secret now. Paste it into the booth Host Admin, under Cloud backup.');
  Logger.log('Do not share this secret with guests.');
}

function doGet() {
  return json_({ ok: true, service: 'SALIN Drive backup' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: 'empty' });
    }
    var data = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || data.secret !== secret) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    if (data.test) {
      return json_({ ok: true, test: true });
    }

    var eventName = safeName_(data.eventName || 'Untitled Event');
    var eventDate = safeName_(data.eventDate || '');
    var folderName = eventDate ? (eventDate + ' ' + eventName) : eventName;

    var root = getOrCreateFolder_(null, 'SALIN Events');
    var eventFolder = getOrCreateFolder_(root, folderName);

    var filename = safeFilename_(data.filename || ('photo-' + new Date().getTime() + '.jpg'));

    var existing = eventFolder.getFilesByName(filename);
    if (existing.hasNext()) {
      var already = existing.next();
      return json_({ ok: true, id: already.getId(), skipped: true });
    }

    if (!data.imageBase64) {
      return json_({ ok: false, error: 'missing image' });
    }

    var bytes = Utilities.base64Decode(data.imageBase64);
    var blob = Utilities.newBlob(bytes, 'image/jpeg', filename);
    var file = eventFolder.createFile(blob);

    var line = filename + '\t' + String(data.caption || '') + '\n';
    var caps = eventFolder.getFilesByName('captions.txt');
    if (caps.hasNext()) {
      var capFile = caps.next();
      var prev = capFile.getBlob().getDataAsString();
      capFile.setContent(prev + line);
    } else {
      eventFolder.createFile('captions.txt', line, MimeType.PLAIN_TEXT);
    }

    return json_({ ok: true, id: file.getId() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.TEXT);
}

function getOrCreateFolder_(parent, name) {
  var base = parent || DriveApp.getRootFolder();
  var it = base.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return base.createFolder(name);
}

function safeName_(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 80) || 'Event';
}

function safeFilename_(s) {
  var name = String(s || 'photo.jpg')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .substring(0, 120);
  if (!/\.jpe?g$/i.test(name)) name += '.jpg';
  return name;
}
