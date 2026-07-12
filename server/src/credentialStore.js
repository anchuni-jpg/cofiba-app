import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Lets the backend silently re-authenticate with cofiba.es after it restarts
// (which wipes the in-memory session map) instead of forcing the client to
// retype their password. Credentials are kept at rest encrypted with a key
// that itself lives outside the repo, in the same data directory.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.data');
const KEY_FILE = path.join(DATA_DIR, 'key.bin');
const STORE_FILE = path.join(DATA_DIR, 'credentials.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getKey() {
  ensureDataDir();
  if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32));
  }
  return fs.readFileSync(KEY_FILE);
}

function readStore() {
  ensureDataDir();
  if (!fs.existsSync(STORE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(store) {
  ensureDataDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store));
}

function encrypt(text) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: encrypted.toString('hex') };
}

function decrypt({ iv, tag, data }) {
  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
}

export function saveCredentials(token, usuario, password) {
  const store = readStore();
  store[token] = { usuario: encrypt(usuario), password: encrypt(password) };
  writeStore(store);
}

export function loadCredentials(token) {
  const store = readStore();
  const entry = store[token];
  if (!entry) return null;
  try {
    return { usuario: decrypt(entry.usuario), password: decrypt(entry.password) };
  } catch {
    return null;
  }
}

export function deleteCredentials(token) {
  const store = readStore();
  delete store[token];
  writeStore(store);
}

// Para arrancar el índice de búsqueda solo con el servidor (sin esperar a
// que alguien busque algo primero) hace falta ALGUNA sesión autenticada con
// la que hablar con cofiba.es. Cualquier credencial guardada sirve — el
// índice es del catálogo general, no de un cliente en concreto.
export function obtenerCredencialCualquiera() {
  const store = readStore();
  const token = Object.keys(store)[0];
  return token ? loadCredentials(token) : null;
}
