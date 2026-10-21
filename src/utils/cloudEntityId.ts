const MAX_ENTITY_ID_BYTES = 900;

export function encodeCloudEntityDocumentId(id: string): string {
  if (typeof id !== 'string' || id.length === 0) throw new Error('Cloud entity id must be a non-empty string');
  // UTF-8 is portable across clients, but unpaired UTF-16 surrogates must be
  // rejected because TextEncoder would replace them and create collisions.
  for (let index = 0; index < id.length; index += 1) {
    const codeUnit = id.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = id.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Cloud entity id contains invalid Unicode');
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Error('Cloud entity id contains invalid Unicode');
    }
  }
  const bytes = new TextEncoder().encode(id);
  if (bytes.byteLength > MAX_ENTITY_ID_BYTES) throw new Error('Cloud entity id is too large');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `e_${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

