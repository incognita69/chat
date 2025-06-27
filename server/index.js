import express from 'express'
import logger from 'morgan'
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import dotenv from 'dotenv'
dotenv.config();

 // 🧩 Agregado justo debajo:
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });  // 👈 Este `upload` lo usarás en el paso 3


console.log('Token cargado:', process.env.DV_TOKEN);

import { createClient } from '@libsql/client'
import { Server } from 'socket.io';
import { createServer } from 'node:http'

const app = express();
const server = createServer(app);

const io = new Server(server, {
    connectionStateRecovery: {}
});

const port = process.env.PORT ?? 3000;

server.listen(port, '0.0.0.0', () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
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
  `);
}

io.on('connection', async (socket) => {
  console.log('a user connected');

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });

  socket.on('chat message', async (msg) => {
    let result;
    try {
      result = await db.execute({
        sql: 'INSERT INTO messages (content) VALUES (:msg)',
        args: { msg }
      });
      console.log('auth ↓');
      console.log(socket.handshake.auth);
    } catch (e) {
      console.error(e);
      return;
    }

    io.emit('chat message', msg, result.lastInsertRowid.toString());
  });

  if (!socket.recovered) {
    try {
      const result = await db.execute({
        sql: 'SELECT id, content FROM messages WHERE id > ?',
        args: [socket.handshake.auth.serverOffset ?? 0]
      });
      result.rows.forEach((row) => {
        socket.emit('chat message', row.content, row.id.toString());
      });
    } catch (e) {
      console.error(e);
      return;
    }
  }
});

app.use(express.static(process.cwd() + '/client'));

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.use(logger('dev'));

// 🧩 PASO 3: Ruta para subir multimedia
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se subió ningún archivo' });
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/client/index.html');
});
