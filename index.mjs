import escpos from 'escpos';
import fs from 'node:fs';
import path from 'node:path';
import usb from 'escpos-usb';
import dotenv from 'dotenv';
import moment from 'moment';
import nodeCmd from 'node-cmd';
import { watch } from 'chokidar'
import { S3 } from "@aws-sdk/client-s3";
import { EOL } from 'node:os';
import createServer from './server.mjs'

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
const targetDir = args[3]
const dirQueue = path.join(dir, 'queue')
const dirProcessed = path.join(dir, 'processed')
const dirUploaded = path.join(dir, 'uploaded')
const dirProcessError = path.join(dir, 'process-error')
const dirUploadError = path.join(dir, 'upload-error')
const dirConfig = path.join(dir, 'config.json')
const dirLog = path.join(dir, 'process.log')

const logFile = fs.createWriteStream(dirLog, { flags: 'a' })

process.env.DIR = dir
process.env.DIR_QUEUE = dirQueue
process.env.DIR_PROCESSED = dirProcessed
process.env.DIR_UPLOADED = dirUploaded
process.env.DIR_PROCESSERROR = dirProcessError
process.env.DIR_UPLOADERROR = dirUploadError
process.env.DIR_CONFIG = dirConfig
process.env.DIR_LOG = dirLog

// Directory Checks

if (!dirExist(dir)) {
  throw new Error(`Path ${dir} is not existed`)
}

if (!dirExist(targetDir)) {
  throw new Error(`Path ${targetDir} is not existed`)
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

watch(targetDir + '/*.JPG', { ignoreInitial: true })
  .on('add', copyToQueue)
watch(dir + '/queue/*.JPG')
  .on('add', appendProcessQueue)
watch(dir + '/processed/*.jpg')
  .on('add', appendUploadQueue)

setInterval(() => {
  nodeCmd.run("run_sync_file.bat", (error, data, stdErr) => {
    if (error || stdErr) {
      console.log(error, stdErr)
    }
  })
}, 1500)

// Server

createServer()

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

// CopyToQueue

async function copyToQueue(filePath) {
  const fileName = path.basename(filePath)
  const newPath = path.join(dirQueue, fileName)
  fs.copyFileSync(filePath, newPath)
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

export function log(...message) {
  const timestamp = moment().format('DD/MM/YYYY HH:mm:ss')
  console.log(timestamp, ...message)
  const messageStr = `[${timestamp}] ${message.join(' ')}`
  logFile.write(messageStr + EOL, 'utf-8')
}