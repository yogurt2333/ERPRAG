import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest();
/** Software authenticator: actual CBOR registration and P-256 assertion signatures, no verifier mock. */
export class TestPasskey {
  key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  id = randomBytes(32); counter = 0; user = '';
  register(options: { challenge: string; user: { id: string } }, overrides: { origin?: string; rp?: string; uv?: boolean; challenge?: string } = {}): RegistrationResponseJSON {
    this.user = options.user.id;
    const jwk = this.key.publicKey.export({ format: 'jwk' });
    const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))]]));
    const length = Buffer.alloc(2); length.writeUInt16BE(this.id.length);
    const authData = Buffer.concat([sha(overrides.rp ?? 'erp.example.test'), Buffer.from([overrides.uv === false ? 0x41 : 0x45]),
      Buffer.alloc(4), Buffer.alloc(16), length, this.id, cose]);
    const attestation = isoCBOR.encode(new Map<string, string | Uint8Array | Map<string, string>>([
      ['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]]));
    return { id: this.id.toString('base64url'), rawId: this.id.toString('base64url'), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: overrides.challenge ?? options.challenge,
        origin: overrides.origin ?? 'https://erp.example.test', crossOrigin: false })).toString('base64url'),
        attestationObject: Buffer.from(attestation).toString('base64url'), transports: ['internal'] } };
  }
  assert(options: { challenge: string }, overrides: { origin?: string; rp?: string; uv?: boolean; challenge?: string; crossOrigin?: boolean; counter?: number } = {}): AuthenticationResponseJSON {
    const count = Buffer.alloc(4); count.writeUInt32BE(overrides.counter ?? ++this.counter);
    const authData = Buffer.concat([sha(overrides.rp ?? 'erp.example.test'), Buffer.from([overrides.uv === false ? 1 : 5]), count]);
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: overrides.challenge ?? options.challenge,
      origin: overrides.origin ?? 'https://erp.example.test', crossOrigin: overrides.crossOrigin ?? false }));
    return { id: this.id.toString('base64url'), rawId: this.id.toString('base64url'), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: clientData.toString('base64url'), authenticatorData: authData.toString('base64url'), userHandle: this.user,
        signature: sign('sha256', Buffer.concat([authData, sha(clientData)]), this.key.privateKey).toString('base64url') } };
  }
}
