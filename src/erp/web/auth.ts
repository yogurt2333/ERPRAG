import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { openDatabase } from '../database.ts';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions,
  verifyAuthenticationResponse, type RegistrationResponseJSON, type AuthenticationResponseJSON,
  type WebAuthnCredential } from '@simplewebauthn/server';

const token = () => randomBytes(32).toString('base64url');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const MINUTE = 60_000;
function sameOriginClient(response: { response: { clientDataJSON: string } }) {
  try {
    const data = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString());
    if (data.crossOrigin === true || data.topOrigin !== undefined) throw 0;
  } catch { throw new WebError(401, 'Cross-origin or malformed client data'); }
}
export const SESSION_SECONDS = 8 * 60 * 60;
export class WebError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
interface User { id: string; name: string }
interface Credential { id: string; user: string; publicKey: string; counter: number; transports?: WebAuthnCredential['transports'] }
export interface Session { user: string; expires: number; verified: number }
interface Grant { user: string; name: string; purpose: 'bootstrap' | 'invite' | 'recovery'; expires: number; issuer?: string }
interface Challenge { challenge: string; purpose: 'register' | 'login' | 'reauth'; expires: number;
  user?: string; grant?: string; session?: string }

/** Internal auth store shares the ERP database, but never exposes its SQL handle. */
export class WebAuth {
  #db: ReturnType<typeof openDatabase>; #clock: () => number;
  readonly origin: string; readonly rpID: string;
  constructor(path: string, origin: string, clock = Date.now) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password)
      throw new Error('ERP_WEB_ORIGIN must be an exact HTTPS origin without path');
    this.origin = origin; this.rpID = url.hostname; this.#clock = clock; this.#db = openDatabase(path);
  }
  close() { this.#db.close(); }
  #get<T>(kind: string, id: string): T | undefined {
    const row = this.#db.prepare('SELECT document FROM web_auth WHERE kind=? AND id=?').get(kind, id);
    return row ? JSON.parse(String(row.document)) as T : undefined;
  }
  #all<T>(kind: string): T[] {
    return this.#db.prepare('SELECT document FROM web_auth WHERE kind=? ORDER BY id').all(kind).map(r => JSON.parse(String(r.document)) as T);
  }
  #put(kind: string, id: string, value: unknown) {
    this.#db.prepare('INSERT INTO web_auth VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET document=excluded.document')
      .run(kind, id, JSON.stringify(value));
  }
  #del(kind: string, id: string) { this.#db.prepare('DELETE FROM web_auth WHERE kind=? AND id=?').run(kind, id); }
  #tx<T>(fn: () => T): T {
    try { this.#db.exec('BEGIN IMMEDIATE'); const value = fn(); this.#db.exec('COMMIT'); return value; }
    catch (e) { if (this.#db.isTransaction) this.#db.exec('ROLLBACK'); throw e; }
  }
  #audit(action: string, user: string) {
    this.#db.prepare('INSERT INTO web_security_events(document) VALUES (?)').run(JSON.stringify({ action, user, at: this.#clock() }));
  }
  #prune() {
    this.#db.prepare("DELETE FROM web_auth WHERE kind IN ('challenge','grant','session') AND json_extract(document,'$.expires') <= ?").run(this.#clock());
  }
  /** Local terminal only; unavailable once any operator exists. Never logged by the HTTP server. */
  bootstrap(name: string) {
    if (!name.trim() || name.length > 100) throw new WebError(400, 'Invalid operator name');
    return this.#tx(() => {
      if (this.#all<User>('user').length) throw new WebError(409, 'Already enrolled');
      this.#db.prepare("DELETE FROM web_auth WHERE kind='grant'").run();
      return this.#grant({ user: randomUUID(), name, purpose: 'bootstrap', expires: this.#clock() + 10 * MINUTE });
    });
  }
  #grant(grant: Grant) { const value = token(); this.#put('grant', hash(value), grant); return value; }
  #validGrant(id: string) {
    const g = this.#get<Grant>('grant', id);
    if (!g || g.expires <= this.#clock()) throw new WebError(401, 'Enrollment grant expired or invalid');
    if (g.purpose === 'bootstrap' && this.#all<User>('user').length) throw new WebError(403, 'Already enrolled');
    if (g.purpose === 'invite') this.#sessionByHash(g.issuer!, true);
    return g;
  }
  invite(sessionToken: string, name: string) {
    const s = this.session(sessionToken, true);
    if (!name.trim() || name.length > 100) throw new WebError(400, 'Invalid operator name');
    return this.#tx(() => {
      if (this.#all<User>('user').length >= 2) throw new WebError(409, 'Two-operator limit');
      this.#audit('invite', s.user);
      return this.#grant({ user: randomUUID(), name, purpose: 'invite', issuer: hash(sessionToken), expires: this.#clock() + 10 * MINUTE });
    });
  }
  #sessionByHash(id: string, recent = false): Session {
    const s = this.#get<Session>('session', id);
    if (!s || s.expires <= this.#clock()) throw new WebError(401, 'Sign in required');
    if (recent && this.#clock() - s.verified >= 5 * MINUTE) throw new WebError(403, 'Recent passkey verification required');
    return s;
  }
  session(value: string, recent = false) { return this.#sessionByHash(hash(value), recent); }
  #newSession(user: string) {
    const value = token(); this.#put('session', hash(value), { user, expires: this.#clock() + SESSION_SECONDS * 1000, verified: this.#clock() });
    return value;
  }
  logout(value: string) { this.#del('session', hash(value)); }
  revokeSessions(value: string) {
    const s = this.session(value, true); this.#revokeUserSessions(s.user); this.#audit('revoke_sessions', s.user);
  }
  #revokeUserSessions(user: string) {
    this.#db.prepare("DELETE FROM web_auth WHERE kind='session' AND json_extract(document,'$.user')=?").run(user);
  }
  profile(value: string) {
    const s = this.session(value);
    return { user: this.#get<User>('user', s.user), expires: s.expires, recent: this.#clock() - s.verified < 5 * MINUTE,
      credentials: this.#all<Credential>('credential').filter(c => c.user === s.user).map(c => ({ id: c.id })),
      recoveryCodesRemaining: this.#all<{ user: string }>('recovery').filter(c => c.user === s.user).length };
  }
  securityHistory(value: string) {
    this.session(value);
    return this.#db.prepare('SELECT document FROM web_security_events ORDER BY id DESC LIMIT 200').all().map(r => JSON.parse(String(r.document)));
  }
  async registrationOptions(grantToken: string | undefined, sessionToken: string) {
    this.#prune();
    const grantId = grantToken ? hash(grantToken) : undefined;
    const grant = grantId ? this.#validGrant(grantId) : undefined;
    const user = grant ?? this.#get<User>('user', this.session(sessionToken, true).user)!;
    const userId = 'user' in user ? user.user : user.id;
    const options = await generateRegistrationOptions({ rpName: '分销 ERP', rpID: this.rpID,
      userID: new TextEncoder().encode(userId), userName: user.name,
      attestationType: 'none', supportedAlgorithmIDs: [-7, -257],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: this.#all<Credential>('credential').filter(c => c.user === userId).map(c => ({ id: c.id })) });
    const flow = token();
    this.#put('challenge', hash(flow), { purpose: 'register', challenge: options.challenge, user: userId, grant: grantId,
      session: grant ? undefined : hash(sessionToken), expires: this.#clock() + 5 * MINUTE } satisfies Challenge);
    return { flow, options };
  }
  #take(flow: string, purpose: Challenge['purpose']) {
    return this.#tx(() => {
      const id = hash(flow), c = this.#get<Challenge>('challenge', id); this.#del('challenge', id);
      if (!c || c.expires <= this.#clock() || c.purpose !== purpose) throw new WebError(401, 'Challenge expired or invalid');
      return c;
    });
  }
  async register(flow: string, response: RegistrationResponseJSON, sessionToken: string) {
    const c = this.#take(flow, 'register');
    sameOriginClient(response);
    const verification = await verifyRegistrationResponse({ response, expectedChallenge: c.challenge,
      expectedOrigin: this.origin, expectedRPID: this.rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] })
      .catch(() => { throw new WebError(401, 'Passkey verification failed'); });
    if (!verification.verified) throw new WebError(401, 'Passkey verification failed');
    return this.#tx(() => {
      const grant = c.grant ? this.#validGrant(c.grant) : undefined;
      if (!grant && (c.session !== hash(sessionToken) || this.session(sessionToken, true).user !== c.user)) throw new WebError(403, 'Session changed');
      if (grant && grant.purpose !== 'recovery' && this.#all<User>('user').length >= 2) throw new WebError(409, 'Two-operator limit');
      const credential = verification.registrationInfo.credential;
      if (this.#get('credential', credential.id)) throw new WebError(409, 'Credential already enrolled');
      if (grant?.purpose !== 'recovery' && this.#all<Credential>('credential').filter(x => x.user === c.user).length >= 10) throw new WebError(409, 'Credential limit');
      if (grant?.purpose === 'recovery') {
        this.#db.prepare("DELETE FROM web_auth WHERE kind='credential' AND json_extract(document,'$.user')=?").run(c.user!);
        this.#revokeUserSessions(c.user!);
      }
      if (grant) { this.#put('user', grant.user, { id: grant.user, name: grant.name }); this.#del('grant', c.grant!); }
      this.#put('credential', credential.id, { ...credential, user: c.user!, publicKey: Buffer.from(credential.publicKey).toString('base64url') });
      this.#audit(grant?.purpose === 'recovery' ? 'recover_credential' : 'enroll_credential', c.user!);
      const codes = grant ? this.#codes(c.user!) : undefined;
      this.logout(sessionToken);
      return { sessionToken: this.#newSession(c.user!), recoveryCodes: codes };
    });
  }
  async loginOptions(sessionToken: string, reauth = false) {
    this.#prune(); const s = reauth ? this.session(sessionToken) : undefined;
    const options = await generateAuthenticationOptions({ rpID: this.rpID, userVerification: 'required',
      ...(s ? { allowCredentials: this.#all<Credential>('credential').filter(c => c.user === s.user).map(c => ({ id: c.id })) } : {}) });
    const flow = token(); this.#put('challenge', hash(flow), { purpose: reauth ? 'reauth' : 'login', challenge: options.challenge,
      user: s?.user, session: s ? hash(sessionToken) : undefined, expires: this.#clock() + 5 * MINUTE } satisfies Challenge);
    return { flow, options };
  }
  async login(flow: string, response: AuthenticationResponseJSON, sessionToken: string, reauth = false) {
    const c = this.#take(flow, reauth ? 'reauth' : 'login');
    sameOriginClient(response);
    const credential = this.#get<Credential>('credential', response.id);
    if (!credential || (c.user && c.user !== credential.user) ||
      (response.response.userHandle && response.response.userHandle !== Buffer.from(credential.user).toString('base64url')))
      throw new WebError(401, 'Passkey verification failed');
    const verification = await verifyAuthenticationResponse({ response, expectedChallenge: c.challenge, expectedOrigin: this.origin,
      expectedRPID: this.rpID, requireUserVerification: true,
      credential: { ...credential, publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')) } })
      .catch(() => { throw new WebError(401, 'Passkey verification failed'); });
    if (!verification.verified) throw new WebError(401, 'Passkey verification failed');
    return this.#tx(() => {
      const current = this.#get<Credential>('credential', credential.id);
      if (!current || current.counter !== credential.counter || current.publicKey !== credential.publicKey) throw new WebError(401, 'Credential changed; retry');
      if (reauth && (c.session !== hash(sessionToken) || this.session(sessionToken).user !== credential.user)) throw new WebError(401, 'Session changed');
      this.#put('credential', credential.id, { ...credential, counter: verification.authenticationInfo.newCounter });
      this.logout(sessionToken); this.#audit(reauth ? 'reauthenticate' : 'sign_in', credential.user);
      return this.#newSession(credential.user);
    });
  }
  #codes(user: string) {
    this.#db.prepare("DELETE FROM web_auth WHERE kind='recovery' AND json_extract(document,'$.user')=?").run(user);
    this.#db.prepare("DELETE FROM web_auth WHERE kind='grant' AND json_extract(document,'$.user')=? AND json_extract(document,'$.purpose')='recovery'").run(user);
    const codes = Array.from({ length: 8 }, token);
    for (const code of codes) this.#put('recovery', hash(code), { user });
    return codes;
  }
  rotateCodes(value: string) { const s = this.session(value, true); return this.#tx(() => { this.#audit('rotate_recovery_codes', s.user); return this.#codes(s.user); }); }
  recover(code: string) {
    return this.#tx(() => {
      const id = hash(code), recovery = this.#get<{ user: string }>('recovery', id);
      if (!recovery) throw new WebError(401, 'Recovery code invalid');
      this.#del('recovery', id); this.#revokeUserSessions(recovery.user);
      // Recovery only grants replacement enrollment, never business or administration access.
      this.#db.prepare("DELETE FROM web_auth WHERE kind='grant' AND json_extract(document,'$.user')=?").run(recovery.user);
      const user = this.#get<User>('user', recovery.user)!; this.#audit('begin_recovery', user.id);
      return this.#grant({ user: user.id, name: user.name, purpose: 'recovery', expires: this.#clock() + 10 * MINUTE });
    });
  }
  removeCredential(value: string, id: string) {
    const s = this.session(value, true);
    this.#tx(() => {
      const credentials = this.#all<Credential>('credential').filter(c => c.user === s.user);
      if (!credentials.some(c => c.id === id)) throw new WebError(404, 'Credential not found');
      if (credentials.length <= 1) throw new WebError(409, 'Enroll a backup before removing the last passkey');
      this.#del('credential', id); this.#revokeUserSessions(s.user); this.#audit('revoke_credential', s.user);
    });
  }
}
