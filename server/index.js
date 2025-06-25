import express from 'express'
import logger from 'morgan'
import dotenv from 'dotenv'
dotenv.config();
console.log('Token cargado:', process.env.DV_TOKEN);


import { createClient } from '@libsql/client'
import { Server } from 'socket.io';
import { createServer } from 'node:http'

const app = express();
const server = createServer(app);


const io = new Server(server,{
    connectionStateRecovery: {} 
})

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`server running on port ${port}`);
});


const db = createClient({
  url: "libsql://chat-incognita69.aws-us-east-1.turso.io",
  authToken: process.env.DV_TOKEN


});

async function initDb() {
await db.execute(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT
)
    `);}




io.on('connection', async (socket) => {
  console.log('a user connected')

 
  socket.on('disconnect', () => {
    console.log('user disconnected')
  })

   socket.on('chat message', async (msg) => {
   let result
   try {
     result = await db.execute({
     sql: 'INSERT INTO messages (content) VALUES (:msg)',
     args: { msg }

    
  })
  console.log('auth ↓')
  console.log(socket.handshake.auth)

    }catch (e) {
      console.error(e)
      return
    }
    

  io.emit('chat message', msg, result.lastInsertRowid.toString())
  })

  if (!socket.recovered)
    try {
        const result = await db.execute({
          sql: 'SELECT id, content FROM messages WhERE id > ?',
          args: [socket.handshake.auth.serverOffset ?? 0]
        })
       result.rows.forEach((row) => {

        socket.emit('chat message', row.content, row.id.toString())
      })
    }
    catch (e) {
      console.error(e)
      return
    }
})

app.use(express.static(process.cwd() + '/client'));

app.use(logger('dev'));

app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/client/index.html');
});
