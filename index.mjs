import escpos from 'escpos';
import fs from 'node:fs';
import path from 'node:path';
import usb from 'escpos-usb';
import dotenv from 'dotenv';
import moment from 'moment';
import { watch } from 'chokidar'
import { S3 } from "@aws-sdk/client-s3";
import { EOL } from 'node:os';

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
const dirUploaded = path.join(dir, 'uploaded')
const dirProcessError = path.join(dir, 'process-error')
const dirUploadError = path.join(dir, 'upload-error')
const dirConfig = path.join(dir, 'config.json')
const dirLog = path.join(dir, 'process.log')

const logFile = fs.createWriteStream(dirLog, { flags: 'a' })

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

if (!dirExist(dirUploaded)) {
  fs.mkdirSync(dirUploaded)
}

if (!dirExist(dirProcessError)) {
  fs.mkdirSync(dirProcessError)
}

if (!dirExist(dirUploadError)) {
  fs.mkdirSync(dirUploadError)
}

// Config File

if (!dirExist(dirConfig)) {
  saveConfig()
}

readConfig()

// Watcher

log(`Start watching ${dirQueue} for *.jpg changes`)

watch(dir + '/queue/*.jpg')
  .on('add', appendProcessQueue)
watch(dir + '/processed/*.jpg')
  .on('add', appendUploadQueue)

// Process Queue

const processQueue = []
let isDrainingProcessQueue = false

function appendProcessQueue(filePath) {
  processQueue.push(filePath)
  if (!isDrainingProcessQueue) {
    isDrainingProcessQueue = true
    drainFileQueue()
  }
}

async function drainFileQueue() {
  if (processQueue.length === 0) {
    return isDrainingProcessQueue = false
  }
  const filePath = processQueue.shift()
  await processFile(filePath)
  return await drainFileQueue()
}

// Upload Queue

const uploadQueue = []
let isDrainingUploadQueue = false

function appendUploadQueue(filePath) {
  uploadQueue.push(filePath)
  if (!isDrainingUploadQueue) {
    isDrainingUploadQueue = true
    drainUploadQueue()
  }
}

async function drainUploadQueue() {
  if (uploadQueue.length === 0) {
    return isDrainingUploadQueue = false
  }
  const filePath = uploadQueue.shift()
  await uploadFile(filePath)
  return await drainUploadQueue()
}

// Process File

async function processFile(filePath) {
  const fileName = path.basename(filePath)
  const newFileName = `${config.queueNumber}_${random()}.jpg`

  // Paths
  const oldPath = path.join(dirQueue, fileName)
  const errPath = path.join(dirProcessError, fileName)
  const newPath = path.join(dirProcessed, newFileName)

  log(`[Start Processing] file: ${filePath}`)

  // Print

  const qrCodeUrl = [
    'https://incs.cc/icv',
    process.env.UPLOAD_ZONE,
    newFileName
  ].join('/')

  try {
    await print(qrCodeUrl)
    // Move File
    fs.renameSync(oldPath, newPath)
    // Save Config
    log(`[Success Q: ${config.queueNumber}] Processed file ${fileName} > ${newFileName}`)
    config.queueNumber += 1
    saveConfig()
  } catch (error) {
    fs.renameSync(oldPath, errPath)
    log(`[Error file: ${fileName}] Error printing! File moved to error folder. Error: ${error}`)
  }
}

// Upload File

async function uploadFile(filePath) {
  const fileName = path.basename(filePath)

  // Paths
  const oldPath = path.join(dirProcessed, fileName)
  const errPath = path.join(dirUploadError, fileName)
  const newPath = path.join(dirUploaded, fileName)

  log(`[Start Uploading] file: ${filePath}`)

  const objectKey = [
    process.env.UPLOAD_FOLDER,
    process.env.UPLOAD_ZONE,
    fileName
  ].join('/')

  try {
    const buffer = fs.readFileSync(oldPath)
    await s3Client.putObject({
      Bucket: 'contents-inc',
      Key: objectKey,
      Body: buffer,
      ContentEncoding: "base64",
      ContentType: "image/jpg",
      ACL: 'public-read',
    })
    // Move File
    fs.renameSync(oldPath, newPath)
    log(`[Success Upload] File uploaded ${fileName}`)
  } catch (error) {
    fs.renameSync(oldPath, errPath)
    log(`[Error file: ${fileName}] Error uploading! File moved to upload-error folder. Error: ${error}`)
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
  log(`Config loaded queueNumber: ${config.queueNumber}`)
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

function log(...message) {
  const timestamp = moment().format('DD/MM/YYYY HH:mm:ss')
  console.log(timestamp, ...message)
  const messageStr = `[${timestamp}] ${message.join(', ')}`
  logFile.write(messageStr + EOL, 'utf-8')
}