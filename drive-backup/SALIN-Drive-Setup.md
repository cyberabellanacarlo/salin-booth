# How to turn on automatic Google Drive backup

This is for the event host (Carlo). Guests never see this. You only need to do it once. After that, every photo that is pinned on the tablet can quietly copy itself to your Google Drive, even in the middle of an event.

You will need a computer (or the tablet’s browser) and the Google account that should own the photos.

---

## 1. Open Apps Script

1. On your computer, go to **https://script.google.com**
2. Sign in with **your** Google account (the same one you use for Drive).
3. Click **New project**.

## 2. Name the project

1. Click the words **Untitled project** at the top.
2. Type **SALIN Drive Backup**
3. Click **Rename**.

## 3. Paste the code

1. You will see a file called **Code.gs** with a little sample function already in it.
2. Select all of that text and delete it.
3. Open the file **Code.gs** that came with the SALIN booth (in the `drive-backup` folder).
4. Copy all of it, and paste it into the empty editor.
5. Click the **Save** icon (the disk) at the top.

## 4. Create your secret

The secret is a private password. The booth will send it with every photo so strangers cannot add files to your Drive.

1. At the top, next to **Run**, there is a drop-down that says **setup** or the name of a function.
2. Open that drop-down and choose **setup**.
3. Click **Run**.

### The first time: allow access

Google will ask you to authorize the script.

1. Click **Review permissions**.
2. Choose your Google account.
3. If you see **Google hasn’t verified this app**, click **Advanced**.
4. Click **Go to SALIN Drive Backup (unsafe)**. It is safe — this is your own script.
5. Click **Allow**.

## 5. Copy the secret from the log

1. After **setup** finishes, look at the **Execution log** at the bottom of the screen.  
   If you do not see it, click **Execution log** in the bar at the bottom, or open **Executions** in the left sidebar and click the latest run.
2. You will see a line that says **Your SALIN backup secret is:** and then a long code under it.
3. Copy that **whole** code. Keep it private. You will paste it into the booth in a later step.

If you ever forget the secret, run **setup** again. It will show the same secret and will not change it. If you want a brand new secret, run **resetSecret** instead, then update the booth.

## 6. Deploy the web app

1. Click **Deploy** (top right).
2. Click **New deployment**.
3. Next to **Select type**, click the gear icon.
4. Click **Web app**.
5. For **Description**, type **SALIN backup**.
6. For **Execute as**, choose **Me**.
7. For **Who has access**, choose **Anyone**.  
   (This does not make your Drive public. Only someone who also has your secret can add photos.)
8. Click **Deploy**.
9. If Google asks you to authorize again, follow the same **Allow** steps as before.
10. You will see a **Web app URL**. Click **Copy**. It looks like  
    `https://script.google.com/macros/s/…/exec`

If you later change the code, click **Deploy** → **Manage deployments** → the pencil (edit) → **Version: New version** → **Deploy**, and keep the same URL.

## 7. Turn it on in the booth

Do this on the **one tablet** that runs the booth.

1. Open the SALIN booth page.
2. Press and hold the **SA·LIN logo** for about one second.
3. Type the host PIN (the first PIN is **1234**; you can change it).
4. You are now in **Host admin**.
5. Scroll to **Cloud backup**.
6. Paste the **Web App URL**.
7. Paste the **Secret**.
8. Fill in the **Event name** and **Event date**. Photos for this event will go into a Drive folder named  
   **SALIN Events / (date) (event name)**  
   for example `SALIN Events/2026-11-10 SALIN Eco Souvenir Bar`.
9. Tap **Test connection**. You should see **Connection works.**
10. Turn the switch **On**.
11. Tap **Close**.

That is all. Guests will not see any backup messages. After each **Pin it!**, the photo is saved on the tablet first, then copied to Drive in the background when the tablet is online.

## During the event

- In **Host admin**, the top line shows **✓ N photos saved · M backed up ☁**.
- You can also tap **Export all (backup so far)** at any time to download a ZIP of every photo already on the tablet. This works even if Drive is off or the internet is down.
- If the Wi‑Fi drops, photos stay in a queue on the tablet and upload when the connection comes back. Nothing pops up for guests.
- If a line of red text appears in Host admin, it is only for you (for example a wrong secret). Guests still do not see it.

## Where the files go

In your Google Drive:

- Folder **SALIN Events**
  - Folder **(event date) (event name)**
    - Each framed souvenir as a `.jpg`
    - A file **captions.txt** with the messages

If the same photo is sent twice, it is not duplicated.

## If Test connection fails

- Make sure **Who has access** is **Anyone**, and that you copied the URL that ends in **/exec** (not /dev).
- Paste the secret again, with no extra space at the start or end.
- Stay signed in to the same Google account that ran **setup**.
- The tablet needs internet for the test and for the silent backup.
