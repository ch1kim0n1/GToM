import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { globalObservability } from './observability.js';
import { sanitizeIdentifier, sanitizeUserString } from './input-sanitizer.js';

export interface StoredSecretMetadata {
  name: string;
  scope?: string;
  owner?: string;
  version: number;
  created_at: string;
  updated_at: string;
  rotated_at?: string;
  key_id: string;
  encrypted: boolean;
}

export interface SetSecretOptions {
  scope?: string;
  owner?: string;
}

interface SecretRecord extends StoredSecretMetadata {
  ciphertext: string;
  iv?: string;
  auth_tag?: string;
  encoding: 'aes-256-gcm' | 'base64';
  previous_versions?: Array<Omit<StoredSecretMetadata, 'name' | 'scope' | 'owner'>>;
}

interface SecretFile {
  schema_version: 1;
  created_at: string;
  updated_at: string;
  secrets: Record<string, SecretRecord>;
}

export class FileSecretManager {
  private readonly filePath: string;
  private readonly masterKey?: string;
  private readonly envFallback: boolean;

  constructor(options: { filePath?: string; masterKey?: string; envFallback?: boolean } = {}) {
    this.filePath = options.filePath
      ?? process.env.GTOM_SECRETS_FILE
      ?? path.join(os.homedir(), '.gtom', 'secrets.json');
    this.masterKey = options.masterKey ?? process.env.GTOM_SECRETS_MASTER_KEY;
    this.envFallback = options.envFallback ?? true;
  }

  getSecret(name: string): string | undefined {
    const safeName = sanitizeSecretName(name);
    const store = this.readStore();
    const record = store.secrets[safeName];
    if (record) {
      return this.decrypt(record);
    }
    return this.envFallback ? process.env[safeName] : undefined;
  }

  setSecret(name: string, value: string, options: SetSecretOptions = {}): StoredSecretMetadata {
    const safeName = sanitizeSecretName(name);
    const safeValue = sanitizeUserString(value, {
      fieldName: 'secret value',
      maxLength: 16_384,
      allowNewlines: false,
      trim: false,
    });
    const safeScope = options.scope ? sanitizeIdentifier(options.scope, 'secret scope') : undefined;
    const safeOwner = options.owner ? sanitizeIdentifier(options.owner, 'secret owner') : undefined;
    const store = this.readStore();
    const now = new Date().toISOString();
    const existing = store.secrets[safeName];
    const version = existing ? existing.version + 1 : 1;
    const encrypted = this.encrypt(safeValue);
    const previous = existing
      ? [
          ...(existing.previous_versions ?? []),
          {
            version: existing.version,
            created_at: existing.created_at,
            updated_at: existing.updated_at,
            rotated_at: now,
            key_id: existing.key_id,
            encrypted: existing.encrypted,
          },
        ]
      : [];
    const record: SecretRecord = {
      name: safeName,
      scope: safeScope ?? existing?.scope,
      owner: safeOwner ?? existing?.owner,
      version,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      rotated_at: existing ? now : undefined,
      key_id: encrypted.key_id,
      encrypted: encrypted.encoding === 'aes-256-gcm',
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.auth_tag,
      encoding: encrypted.encoding,
      previous_versions: previous,
    };
    store.secrets[safeName] = record;
    this.writeStore(store);
    globalObservability.audit.recordSecurityEvent({
      event_type: existing ? 'secret_rotated' : 'secret_set',
      actor: record.owner ?? 'local',
      resource: safeName,
      metadata: { scope: record.scope, version },
    });
    return publicMetadata(record);
  }

  rotateSecret(name: string, value: string, options: SetSecretOptions = {}): StoredSecretMetadata {
    const safeName = sanitizeSecretName(name);
    if (!this.readStore().secrets[safeName] && !process.env[safeName]) {
      throw new Error(`Secret ${safeName} does not exist`);
    }
    return this.setSecret(safeName, value, options);
  }

  deleteSecret(name: string): boolean {
    const safeName = sanitizeSecretName(name);
    const store = this.readStore();
    if (!store.secrets[safeName]) return false;
    delete store.secrets[safeName];
    this.writeStore(store);
    globalObservability.audit.recordSecurityEvent({
      event_type: 'secret_deleted',
      actor: 'local',
      resource: safeName,
    });
    return true;
  }

  listSecrets(): StoredSecretMetadata[] {
    return Object.values(this.readStore().secrets).map(publicMetadata);
  }

  getFilePath(): string {
    return this.filePath;
  }

  private encrypt(value: string): {
    ciphertext: string;
    iv?: string;
    auth_tag?: string;
    encoding: 'aes-256-gcm' | 'base64';
    key_id: string;
  } {
    if (!this.masterKey) {
      return {
        ciphertext: Buffer.from(value, 'utf8').toString('base64'),
        encoding: 'base64',
        key_id: 'local-file',
      };
    }
    const iv = crypto.randomBytes(12);
    const key = crypto.createHash('sha256').update(this.masterKey).digest();
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      auth_tag: cipher.getAuthTag().toString('base64'),
      encoding: 'aes-256-gcm',
      key_id: crypto.createHash('sha256').update(this.masterKey).digest('hex').slice(0, 12),
    };
  }

  private decrypt(record: SecretRecord): string {
    if (record.encoding === 'base64') {
      return Buffer.from(record.ciphertext, 'base64').toString('utf8');
    }
    if (!this.masterKey) {
      throw new Error(`Secret ${record.name} requires GTOM_SECRETS_MASTER_KEY`);
    }
    if (!record.iv || !record.auth_tag) {
      throw new Error(`Secret ${record.name} is missing encryption metadata`);
    }
    const key = crypto.createHash('sha256').update(this.masterKey).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.auth_tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private readStore(): SecretFile {
    if (!fs.existsSync(this.filePath)) {
      const now = new Date().toISOString();
      return {
        schema_version: 1,
        created_at: now,
        updated_at: now,
        secrets: {},
      };
    }
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as SecretFile;
    if (parsed.schema_version !== 1 || !parsed.secrets) {
      throw new Error(`Unsupported secret store schema at ${this.filePath}`);
    }
    return parsed;
  }

  private writeStore(store: SecretFile): void {
    store.updated_at = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, this.filePath);
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // Best effort on Windows filesystems.
    }
  }
}

export const defaultSecretManager = new FileSecretManager();

function sanitizeSecretName(name: string): string {
  return sanitizeIdentifier(name, 'secret name', 128);
}

function publicMetadata(record: SecretRecord): StoredSecretMetadata {
  return {
    name: record.name,
    scope: record.scope,
    owner: record.owner,
    version: record.version,
    created_at: record.created_at,
    updated_at: record.updated_at,
    rotated_at: record.rotated_at,
    key_id: record.key_id,
    encrypted: record.encrypted,
  };
}
