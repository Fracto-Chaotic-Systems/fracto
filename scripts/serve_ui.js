import path from 'node:path'

import express from 'express'

import {FRACTO_UI_PORT} from '../constants.js'

const dist_directory = path.join(import.meta.dirname, '..', 'servers', 'fracto-ui', 'dist')
const index_file = path.join(dist_directory, 'index.html')
const app = express()

app.use(express.static(dist_directory, {index: false}))
app.get('/', (request, response) => response.sendFile(index_file))
app.use((request, response) => response.sendFile(index_file))

app.listen(FRACTO_UI_PORT, '0.0.0.0', () => {
   console.log(`Fracto UI is running on http://localhost:${FRACTO_UI_PORT}`)
})
