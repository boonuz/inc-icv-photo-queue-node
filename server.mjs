import express from 'express'
import path from 'node:path'
import { log } from './index.mjs'
import { readdirSync } from 'node:fs'

export default function createServer() {
  const app = express()

  // Paths

  const dir = process.env.DIR
  const dirQueue = process.env.DIR_QUEUE
  const dirProcessed = process.env.DIR_PROCESSED
  const dirUploaded = process.env.DIR_UPLOADED
  const dirProcessError = process.env.DIR_PROCESSERROR
  const dirUploadError = process.env.DIR_UPLOADERROR
  const dirConfig = process.env.DIR_CONFIG
  const dirLog = process.env.DIR_LOG

  // Routes

  app.get('/', (req, res) => {
    const html = path.resolve('./dashboard.html')
    res.sendFile(html)
  })

  app.get('/status', (req, res) => {
    const info = getDirsInfo()
    res.send(info)
  })
  app.use('/static', express.static(path.resolve(dir)))

  // Bootstrap

  app.listen(3000, () => logServer('Server listening :3000'))

  // Helpers

  function getDirsInfo() {
    return {
      queue: readDirInfo(dirQueue),
      processed: readDirInfo(dirProcessed),
      uploaded: readDirInfo(dirUploaded),
      processError: readDirInfo(dirProcessError),
      uploadError: readDirInfo(dirUploadError),
    }
  }

  function readDirInfo(path) {
    return readdirSync(path).filter(f => !f.startsWith('.'))
  }
}

function logServer(...message) {
  log('[Server]', ...message)
}