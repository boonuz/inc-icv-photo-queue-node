# Image Queue 

### CLI
```bash
$ node index.mjs [watch directory path]
```

### Running
1. Config .env file
2. Connect USB Printer
3. Run Commands
```bash
$ npm install
$ node index.mjs ./dir-to-watch
```
4. Open http://localhost:3000 in browser for dashboard

### Process Flow
#### 1. Queue Images
- Folder: `/queue` = put image file from camera here

#### 2. Print Queue Number
- Folder: `/processed` = [success] assigned image to queue no. + print slip
- Folder: `/process-error` = [error] cannot printing slip

**[NOTE]** You can drag file from `/process-error` back to `/queue` folder to retry printing

#### 3. Upload to cloud storage
- Folder: `/uploaded` = [success] image file is uploaded to cloud server
- Folder: `/upload-error` = [error] cannot upload to cloud server

**[NOTE]** You can drag file from `/upload-error` back to `/processed` folder to retry uploading
 