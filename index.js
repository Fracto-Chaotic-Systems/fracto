import express from 'express'
import {FRACTO_SERVER_PORT} from './constants.js'

import {handle_main} from "./handlers/main.js";
import {handle_status} from "./handlers/status.js";

const app = express();

app.use((req, res, next) => {
   res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins
   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); // Specify allowed methods
   res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With'); // Specify allowed headers
   next();
});

// Start the server and listen for incoming requests
app.listen(FRACTO_SERVER_PORT, () => {
   console.log(`Server is running on http://localhost:${FRACTO_SERVER_PORT}`);
});

app.get('/', handle_main)
app.get('/status', handle_status)