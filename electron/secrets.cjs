const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const SECRETS_FILE = 'secrets.json';
const MAX_SECRET_LENGTH = 8192;

function createSecretStore({ userDataPath, safeStorage }) {
  const filePath = path.join(path.resolve(userDataPath), SECRETS_FILE);
  let writeQueue = Promise.resolve();

  const readFile = async () => {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      return parsed?.schemaVersion === 1 && typeof parsed.geminiApiKey === 'string' ? parsed : null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  };

  const writeFile = (data) => {
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = path.join(path.dirname(filePath), `.secrets.${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
      const handle = await fs.open(tempPath, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(data), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await fs.rename(tempPath, filePath);
      } catch (error) {
        await fs.unlink(tempPath).catch(() => {});
        throw error;
      }
    });
    return writeQueue;
  };

  const setGeminiApiKey = async (value) => {
    const key = typeof value === 'string' ? value.trim() : '';
    if (!key || key.length > MAX_SECRET_LENGTH) throw new Error('Invalid Gemini API key');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is unavailable');
    const encrypted = safeStorage.encryptString(key).toString('base64');
    await writeFile({ schemaVersion: 1, geminiApiKey: encrypted });
  };

  const getGeminiApiKey = async () => {
    const stored = await readFile();
    if (!stored) return null;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is unavailable');
    return safeStorage.decryptString(Buffer.from(stored.geminiApiKey, 'base64'));
  };

  return Object.freeze({
    filePath,
    hasGeminiApiKey: async () => Boolean(await readFile()),
    getGeminiApiKey,
    setGeminiApiKey,
    importLegacyGeminiApiKey: async (value) => {
      if (await readFile()) return false;
      if (typeof value !== 'string' || !value.trim()) return false;
      await setGeminiApiKey(value);
      return true;
    },
    clearGeminiApiKey: async () => {
      await fs.unlink(filePath).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    },
    flush: () => writeQueue,
  });
}

module.exports = { createSecretStore, MAX_SECRET_LENGTH };
