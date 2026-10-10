import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const RESOURCE = 'https://api.openai.com/v1';
const ISSUER = 'https://auth.openai.com';
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const random = () => randomBytes(32).toString('base64url');

// Windows DPAPI binds credentials to this Windows user. Secrets travel via
// stdin/stdout inside the process, never via command-line arguments or logs.
async function protect(text, decrypt = false) {
  if (process.platform !== 'win32') throw new Error('Subscription credential storage currently requires Windows.');
  const script = decrypt
    ? "$ErrorActionPreference='Stop'; $null=[Reflection.Assembly]::LoadWithPartialName('System.Security'); $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))"
    : "$ErrorActionPreference='Stop'; $null=[Reflection.Assembly]::LoadWithPartialName('System.Security'); $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))";
  return await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    let output = '';
    child.stdout.on('data', b => output += b);
    child.stderr.resume();
    child.on('error', () => reject(new Error('Cannot access Windows protected credential storage.')));
    child.on('close', code => code === 0 ? resolve(decrypt ? Buffer.from(output, 'base64').toString('utf8') : output) : reject(new Error('Windows credential protection failed.')));
    child.stdin.end(decrypt ? text : Buffer.from(text, 'utf8').toString('base64'));
  });
}

async function tokenRequest(fields) {
  const response = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams(fields), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`ChatGPT authorization/refresh failed (HTTP ${response.status}). Run --login to reconnect.`);
  const data = await response.json();
  if (!data.access_token || data.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(data.expires_in))
    throw new Error('ChatGPT returned an incomplete token response.');
  return data;
}

export class SubscriptionAuth {
  constructor(directory) { this.directory = directory; this.file = join(directory, 'chatgpt.dpapi'); }
  async load() {
    try { this.state = JSON.parse(await protect(await readFile(this.file, 'utf8'), true)); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.state = { hostId: `urn:uuid:${randomUUID()}`, active: null, profiles: [] };
      await this.save();
    }
    return this;
  }
  async save() {
    await mkdir(this.directory, { recursive: true });
    const encrypted = await protect(JSON.stringify(this.state));
    await writeFile(`${this.file}.tmp`, encrypted);
    await rename(`${this.file}.tmp`, this.file);
  }
  profile() { return this.state.profiles.find(p => p.client_id === this.state.active); }
  async select(number) {
    const profile = this.state.profiles[number - 1];
    if (!profile) throw new Error('Unknown account number. Use --accounts.');
    this.state.active = profile.client_id;
    await this.save();
  }
  list() { return this.state.profiles.map((p, i) => ({ number: i + 1, email: p.email || 'Pending registration', active: p.client_id === this.state.active })); }

  async login(newAccount = false) {
    const previous = newAccount ? null : (this.profile() || this.state.profiles.find(p => p.client_id === this.state.pending));
    const state = random(), nonce = random(), verifier = random();
    let complete, fail;
    const callback = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      res.setHeader('Content-Type', 'text/plain');
      if (url.pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
      if (url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid sign-in state.'); return; }
      if (url.searchParams.has('error')) { res.end('Sign-in was declined. Return to the runner.'); fail(new Error('ChatGPT sign-in was declined.')); return; }
      const code = url.searchParams.get('code');
      const clientId = url.searchParams.get('client_id') || previous?.client_id;
      if (!code || !clientId || clientId === 'dynamic_agent_client' || (previous && clientId !== previous.client_id)) {
        res.writeHead(400).end('Incomplete registration.'); fail(new Error('Incomplete ChatGPT registration.')); return;
      }
      res.end('Sign-in received. Return to the Prove It runner to finish verification.');
      complete({ code, clientId });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const redirect = `http://127.0.0.1:${server.address().port}/auth/callback`;
    const url = new URL(`${ISSUER}/api/accounts/authorize`);
    const params = { client_id: previous?.client_id || 'dynamic_agent_client', ext_agent_host_id: this.state.hostId,
      response_type: 'code', redirect_uri: redirect, scope: SCOPE, resource: RESOURCE, state, nonce,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') };
    if (!previous) params.agent_name_hint = 'Prove It Construction Verification';
    if (previous?.id_token) params.id_token_hint = previous.id_token;
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    console.log('Continue with ChatGPT: opening browser. Authorize ChatGPT plan usage for Prove It.');
    const browser = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop'; $p=[Diagnostics.ProcessStartInfo]::new(); $p.FileName=$env:PROVE_IT_SIGNIN_URL; $p.UseShellExecute=$true; $null=[Diagnostics.Process]::Start($p)"],
      { windowsHide: true, env: { ...process.env, PROVE_IT_SIGNIN_URL: url.href }, stdio: 'ignore' });
    browser.on('error', () => fail(new Error('Cannot open the sign-in browser.')));
    browser.on('close', code => { if (code !== 0) fail(new Error('Cannot open the sign-in browser.')); });
    const timer = setTimeout(() => fail(new Error('Sign-in timed out after five minutes. Run --login again.')), 300000);
    try {
      const { code, clientId } = await callback;
      // Retain the issued registration even if exchanging the short-lived code fails.
      let profile = this.state.profiles.find(p => p.client_id === clientId);
      if (!profile) { profile = { client_id: clientId }; this.state.profiles.push(profile); }
      this.state.pending = clientId;
      await this.save();
      const tokens = await tokenRequest({ grant_type: 'authorization_code', client_id: clientId, code,
        code_verifier: verifier, redirect_uri: redirect, resource: RESOURCE });
      if (!tokens.id_token) throw new Error('ChatGPT did not return an identity token.');
      const discovery = await fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(30000) });
      if (!discovery.ok) throw new Error('Cannot retrieve OpenAI identity configuration.');
      const oidc = await discovery.json();
      if (oidc.issuer !== ISSUER || !oidc.jwks_uri?.startsWith(`${ISSUER}/`)) throw new Error('Unexpected OpenAI identity issuer.');
      const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(oidc.jwks_uri)),
        { issuer: ISSUER, audience: clientId, requiredClaims: ['exp', 'sub', 'nonce'] });
      if (payload.nonce !== nonce || !payload.sub || (previous?.subject && previous.subject !== payload.sub))
        throw new Error('ChatGPT identity verification failed.');
      const scopes = (tokens.scope || '').split(' ');
      if (!scopes.includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT plan usage was not granted. Run --login and enable it.');
      Object.assign(profile, tokens, { subject: payload.sub, email: payload.email, scopes, expires_at: Date.now() + tokens.expires_in * 1000 });
      this.state.active = clientId;
      delete this.state.pending;
      await this.save();
      console.log(`Connected: ${profile.email || 'ChatGPT account'}. ChatGPT plan usage enabled.`);
    } finally { clearTimeout(timer); server.closeAllConnections(); server.close(); }
  }

  async accessToken() {
    let profile = this.profile();
    if (!profile?.access_token) { await this.login(); profile = this.profile(); }
    if (!profile.scopes?.includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT plan usage permission is missing. Run --login.');
    if (profile.expires_at < Date.now() + 60000) {
      if (!profile.refresh_token) throw new Error('ChatGPT session expired. Run --login.');
      const tokens = await tokenRequest({ grant_type: 'refresh_token', client_id: profile.client_id,
        refresh_token: profile.refresh_token, resource: RESOURCE });
      const scopes = tokens.scope ? tokens.scope.split(' ') : profile.scopes;
      if (!scopes.includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT plan usage permission was revoked.');
      Object.assign(profile, tokens, { scopes, expires_at: Date.now() + tokens.expires_in * 1000 });
      await this.save();
    }
    return profile.access_token;
  }

  async models() {
    const token = await this.accessToken();
    const res = await fetch(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`ChatGPT model discovery failed (HTTP ${res.status}).`);
    const data = await res.json();
    if (!Array.isArray(data.models)) throw new Error('Unexpected ChatGPT model catalog; cannot confirm model access.');
    return data.models.filter(m => m.visibility === 'list');
  }
}
