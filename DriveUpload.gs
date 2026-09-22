/*  Heatsink Loading — Google Drive upload receiver (Apps Script Web App)
 *
 *  SETUP (one time, ~5 min):
 *  1) Make a folder in Google Drive where the PDFs should go.
 *     Open it, copy the FOLDER ID from the URL:
 *     https://drive.google.com/drive/folders/XXXXXXXXXXXXXXXXX   <- the XXXX part
 *  2) Go to https://script.google.com  ->  New project.
 *  3) Delete the sample code, paste ALL of this file.
 *  4) Fill in FOLDER_ID and TOKEN below (pick any hard-to-guess TOKEN string).
 *  5) Deploy -> New deployment -> type "Web app".
 *        - Description: heatsink upload
 *        - Execute as: Me
 *        - Who has access: Anyone
 *     Click Deploy, authorize when asked.
 *  6) Copy the "Web app URL" (ends with /exec).
 *  7) In the phone app: gear icon -> paste the URL and the same TOKEN -> Save.
 *
 *  To send PDFs to a different folder later, change FOLDER_ID and Deploy -> Manage
 *  deployments -> edit -> Version: New version -> Deploy (keeps the same URL).
 */

var FOLDER_ID = 'PASTE_DRIVE_FOLDER_ID_HERE';
var TOKEN     = 'PASTE_A_SECRET_TOKEN_HERE';

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.token !== TOKEN) {
      return json({ ok: false, error: 'bad token' });
    }
    var folder = DriveApp.getFolderById(FOLDER_ID);
    var bytes = Utilities.base64Decode(body.data);
    var blob = Utilities.newBlob(bytes, body.mimeType || 'application/pdf', body.filename || 'upload.pdf');

    // Replace any existing file with the same name (re-export of the same day).
    var existing = folder.getFilesByName(blob.getName());
    while (existing.hasNext()) { existing.next().setTrashed(true); }

    var file = folder.createFile(blob);
    return json({ ok: true, id: file.getId(), name: file.getName(), url: file.getUrl() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// Lets you open the /exec URL in a browser to check it is alive.
function doGet() {
  return json({ ok: true, service: 'heatsink upload', ready: true });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
