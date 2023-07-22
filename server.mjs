import express from 'express'
import readLast from 'read-last-lines'
import path from 'node:path'
import { log } from './index.mjs'
import { readdirSync, renameSync } from 'node:fs'

export default function createServer() {
  const app = express()
  app.use(express.json())

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

  app.get('/status', async (req, res) => {
    const info = await getDirsInfo()
    res.send(info)
  })

  app.post('/retry', (req, res) => {
    const { path } = req.body

    if (path === undefined) {
      throw new Error('"path" is required')
    }

    if (path === 'process-error') {
      retry(dirProcessError, dirQueue)
    } else if (path === 'upload-error') {
      retry(dirUploadError, dirProcessed)
    } else {
      throw new Error('"path" is invalid')
    }

    res.send({ message: 'ok' })
  })


  // Bootstrap

  app.use('/static', express.static(path.resolve(dir)))
  app.listen(3000, () => logServer('Server listening :3000'))

  // Helpers

  async function getDirsInfo() {
    return {
      queue: readDirInfo(dirQueue),
      processed: readDirInfo(dirProcessed),
      uploaded: readDirInfo(dirUploaded),
      processError: readDirInfo(dirProcessError),
      uploadError: readDirInfo(dirUploadError),
      logs: await readLog()
    }
  }

  function readDirInfo(path) {
    return readdirSync(path).filter(f => !f.startsWith('.')).reverse()
  }

  async function readLog() {
    const lines = await readLast.read(dirLog, 8, 'utf-8')
    return lines.split('\n')
  }

  function retry(dir, newDir) {
    const files = readDirInfo(dir)
    logServer(`Retrying files ${dir} > ${newDir}`)
    files.forEach(fileName => {
      const oldPath = path.join(dir, fileName)
      const newPath = path.join(newDir, fileName)
      renameSync(oldPath, newPath)
      logServer(`File retry ${oldPath} > ${newPath}`)
    })
  }
}

function logServer(...message) {
  log('[Server]', ...message)
}