import escpos from 'escpos';
import fs from 'node:fs';
import path from 'node:path';
import usb from 'escpos-usb';
import dotenv from 'dotenv';
import moment from 'moment';
import { watch } from 'chokidar'
import { S3 } from "@aws-sdk/client-s3";

// Printer

escpos.USB = usb
const device = new escpos.USB();
const printer = new escpos.Printer(device);

// Config

dotenv.config()

let config = {
  queueNumber: 1
}

const s3Client = new S3({
  forcePathStyle: false, // Configures to use subdomain/virtual calling format.
  endpoint: "https://sgp1.digitaloceanspaces.com",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET
  }
});

// Args

const args = process.argv

if (args.length === 2) {
  throw new Error('Expected watch folder path')
}

const dir = args[2]
const dirQueue = path.join(dir, 'queue')
const dirProcessed = path.join(dir, 'processed')
const dirError = path.join(dir, 'error')
const dirConfig = path.join(dir, 'config.json')

// Directory Checks

if (!dirExist(dir)) {
  throw new Error(`Path ${dir} is not existed`)
}

if (!dirExist(dirQueue)) {
  fs.mkdirSync(dirQueue)
}

if (!dirExist(dirProcessed)) {
  fs.mkdirSync(dirProcessed)
}

if (!dirExist(dirError)) {
  fs.mkdirSync(dirError)
}

// Config File

if (!dirExist(dirConfig)) {
  saveConfig()
}

readConfig()

// Watcher

console.log(`Start watching ${dirQueue} for *.jpg changes`)

const watcher = watch(dir + '/queue/*.jpg')
  .on('add', onFileChange)

async function onFileChange(filePath) {
  const fileName = path.basename(filePath)
  const newFileName = `${config.queueNumber}_${random()}.jpg`

  // Paths
  const oldPath = path.join(dirQueue, fileName)
  const errPath = path.join(dirError, fileName)
  const newPath = path.join(dirProcessed, newFileName)

  // Status
  let isPrintSuccess = false
  let isUploadSuccess = false

  // Print

  const qrCodeUrl = [
    'https://incs.cc/icv',
    process.env.UPLOAD_ZONE,
    newFileName
  ].join('/')

  const printPromise = print(qrCodeUrl)

  // Upload File

  const objectKey = [
    process.env.UPLOAD_FOLDER,
    process.env.UPLOAD_ZONE,
    newFileName
  ].join('/')

  const buffer = fs.readFileSync(oldPath)
  const uploadPromise = s3Client.putObject({
    Bucket: 'contents-inc',
    Key: objectKey,
    Body: buffer,
    ContentEncoding: "base64",
    ContentType: "image/jpg",
    ACL: 'public-read',
  })

  // Move file

  try {
    await Promise.all([
      printPromise
        .then(() => isPrintSuccess = true)
        .catch(e => console.log(`[Error file: ${fileName}] Error printing ${e}`)),
      uploadPromise
        .then(() => isUploadSuccess = true)
        .catch(e => console.log(`[Error file: ${fileName}] Error uploading file ${e}`)),
    ])
  } catch (error) {
    console.error(`Error processing file ${fileName}`)
    console.error(error)
  }

  if (isPrintSuccess && isUploadSuccess) {
    fs.renameSync(oldPath, newPath)
    // Save Config
    console.log(`[Success Q: ${config.queueNumber}] Processed file ${fileName} > ${newFileName}`)
    config.queueNumber += 1
    saveConfig()
  } else {
    fs.renameSync(oldPath, errPath)
    console.log(`[Error file: ${fileName}] is not processed! File moved to error folder`)
  }
}

// Helper

function dirExist(path) {
  return fs.existsSync(path)
}

function saveConfig() {
  const configStr = JSON.stringify(config)
  fs.writeFileSync(dirConfig, configStr)
}

function readConfig() {
  const configStr = fs.readFileSync(dirConfig, 'utf-8')
  config = JSON.parse(configStr)
  console.log(`Config loaded queueNumber: ${config.queueNumber}`)
}

function random() {
  return Math.round((Math.random() * 1000000)).toString().padStart(6, '0')
}

function print(url) {
  return new Promise((res, rej) => {
    const timestamp = moment().format('DD/MM/YYYY HH:mm:ss')
    device.open((err) => {
      printer
        .align('CT')
        .text('Queue Number')
        .size(2, 2)
        .text(config.queueNumber)
        .qrimage(url, () => {
          printer
            .newLine()
            .size(0)
            .text('Scan QR Code to download photo')
            .text(timestamp)
            .cut(true, 4)
            .close(err => err ? rej(err) : res())
        })
    })
  })
}