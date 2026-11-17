import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, randomBytes, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import { labClientConfigSchema, type LabClientConfig } from '@factoryze/protocol';

export type ServerIdentity = { key: string; cert: string; operatorToken: string; connection: LabClientConfig };
export const certificateFingerprint = (pem: string) => createHash('sha256').update(new X509Certificate(pem).raw).digest('hex');

/** Creates a dedicated, new state directory. Only client.json is distributed to students. */
export function initializeServer(directory: string, advertisedURL: string, openssl = process.env.FACTORYZE_OPENSSL ?? 'openssl'): LabClientConfig {
  const url = new URL(advertisedURL), host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (!isIP(host) && !/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(host))) throw Error('Use an HTTPS origin with the server DNS name or IP address');
  const root = resolve(directory);
  if (existsSync(root)) throw Error('Server state directory already exists; identity will not be overwritten');
  mkdirSync(root, { mode: 0o700 });
  const names = ['openssl.cnf', 'server-key.pem', 'server-cert.pem', 'operator.json', 'client.json'];
  try {
    writeFileSync(join(root, 'openssl.cnf'), `[req]\ndistinguished_name=dn\n[dn]\n`, { mode: 0o600, flag: 'wx' });
    // OpenSSL is used only for first-run certificate issuance, without a shell or global trust changes.
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:3072', '-sha256', '-noenc', '-days', '365', '-batch',
      '-config', join(root, 'openssl.cnf'), '-subj', '/CN=Factoryze Lab', '-addext', `subjectAltName=${isIP(host) ? 'IP' : 'DNS'}:${host}`,
      // Electron uses BoringSSL: its explicit trust anchor must be CA-capable, unlike Node/OpenSSL's leaf trust.
      // A zero path length and the client's exact certificate pin forbid substituting a signed descendant.
      '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0', '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign',
      '-addext', 'extendedKeyUsage=serverAuth', '-keyout', join(root, 'server-key.pem'), '-out', join(root, 'server-cert.pem')],
      { timeout: 30_000, windowsHide: true, stdio: 'pipe' });
    const certificate = readFileSync(join(root, 'server-cert.pem'), 'utf8');
    const connection = labClientConfigSchema.parse({ schema: 1, protocol: 1, baseURL: url.origin,
      certificate, fingerprint: certificateFingerprint(certificate) });
    writeFileSync(join(root, 'operator.json'), JSON.stringify({ token: randomBytes(32).toString('base64url') }) + '\n', { mode: 0o600, flag: 'wx' });
    writeFileSync(join(root, 'client.json'), JSON.stringify(connection, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    unlinkSync(join(root, 'openssl.cnf'));
    loadIdentity(root);
    return connection;
  } catch {
    // Only remove these known files from the directory created by this invocation; never recurse.
    for (const name of names) if (existsSync(join(root, name))) unlinkSync(join(root, name));
    rmdirSync(root);
    throw Error('Server initialization failed. Install OpenSSL 3 or set FACTORYZE_OPENSSL to its executable; use a new private state directory.');
  }
}
export function loadIdentity(directory: string): ServerIdentity {
  const key = readFileSync(join(directory, 'server-key.pem'), 'utf8'), cert = readFileSync(join(directory, 'server-cert.pem'), 'utf8');
  const connection = labClientConfigSchema.parse(JSON.parse(readFileSync(join(directory, 'client.json'), 'utf8')));
  const operator = JSON.parse(readFileSync(join(directory, 'operator.json'), 'utf8'));
  const x509 = new X509Certificate(cert);
  if (certificateFingerprint(cert) !== connection.fingerprint || certificateFingerprint(connection.certificate) !== connection.fingerprint ||
      !x509.checkPrivateKey(createPrivateKey(key)) || Date.parse(x509.validTo) <= Date.now() || Date.parse(x509.validFrom) > Date.now() ||
      !/^[A-Za-z0-9_-]{43}$/.test(operator.token)) throw Error('Server identity is invalid, expired or inconsistent');
  return { key, cert, operatorToken: operator.token, connection };
}
