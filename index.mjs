import escpos from 'escpos';
import fs from 'node:fs';
import path from 'node:path';
import usb from 'escpos-usb';
import dotenv from 'dotenv';
import { watch } from 'chokidar'
import { S3 } from "@aws-sdk/client-s3";

escpos.USB = usb

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
const dirConfig = path.join(dir, 'config.json')

// Directory Checks

if (!dirExist(dir)) {
  throw new Error(`Path ${dir} is not existed`)
}

if (!dirExist(dirQueue)) {
  throw new Error(`Path ${dirQueue} is not existed`)
}

if (!dirExist(dirProcessed)) {
  throw new Error(`Path ${dirProcessed} is not existed`)
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

  // Move file
  const oldPath = path.join(dirQueue, fileName)
  const newPath = path.join(dirProcessed, newFileName)

  fs.renameSync(oldPath, newPath)

  // Print

  const qrCodeUrl = [
    'https://incs.cc/icv',
    process.env.UPLOAD_ZONE,
    newFileName
  ].join('/')

  // Upload File

  const objectKey = [
    process.env.UPLOAD_FOLDER,
    process.env.UPLOAD_ZONE,
    newFileName
  ].join('/')

  try {
    const buffer = fs.readFileSync(newPath)
    const response = await s3Client.putObject({
      Bucket: 'contents-inc',
      Key: objectKey,
      Body: buffer,
      ContentEncoding: "base64",
      ContentType: "image/jpg",
      ACL: 'public-read',
    })
  } catch (error) {
    console.error(error)
  }

  // Save config
  console.log(`[Q-${config.queueNumber}] Processed file ${fileName} > ${newFileName}`)
  config.queueNumber += 1
  saveConfig()
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