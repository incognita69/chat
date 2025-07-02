import express from 'express';
import logger from 'morgan';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { createClient } from '@libsql/client';
import { Server } from 'socket.io';
import { createServer } from 'node:http';

dotenv.config();

// Configuración multer para subida de archivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

console.log('Token cargado:', process.env.DV_TOKEN);

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
  url: 'libsql://chat-incognita69.aws-us-east-1.turso.io',
  authToken: process.env.DV_TOKEN
});

// Crear tabla mensajes si no existe
async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT
    )
  `);
}
initDb();

// Middleware Socket.IO para validar token JWT
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Token no proporcionado'));
  jwt.verify(token, process.env.SECRET_JWT_KEY, (err, decoded) => {
    if (err) return next(new Error('Token inválido'));
    socket.user = {
      username: decoded.username,
      id: decoded.id // si incluyes id en token
    };
    next();
  });
});

// Mapa para usuarios conectados (userId => socket)
const users = new Map();

io.on('connection', async (socket) => {
  console.log(`${socket.user.username} conectado`);
  users.set(socket.user.id, socket);

  socket.on('disconnect', () => {
    users.delete(socket.user.id);
    console.log(`${socket.user.username} desconectado`);
  });

  // Mensaje público (chat global)
  socket.on('chat message', async (msg) => {
    let result;
    try {
      result = await db.execute({
        sql: 'INSERT INTO messages (content) VALUES (:msg)',
        args: { msg }
      });
    } catch (e) {
      console.error('Error al guardar mensaje:', e);
      return;
    }

    io.emit('chat message', msg, result.lastInsertRowid.toString());
  });

  // Mensaje privado
  socket.on('private message', ({ toUserId, message }) => {
    const targetSocket = users.get(toUserId);
    if (targetSocket) {
      targetSocket.emit('private message', {
        fromUserId: socket.user.id,
        fromUsername: socket.user.username,
        message
      });
    } else {
      console.log('Usuario objetivo no conectado:', toUserId);
    }
  });

  // Enviar mensajes históricos si no es reconexión
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
    }
  }
});

// Middlewares y rutas HTTP
app.use(express.static(process.cwd() + '/client'));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use(logger('dev'));

// Ruta para subir multimedia
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se subió ningún archivo' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// Página principal
app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/client/index.html');
});
