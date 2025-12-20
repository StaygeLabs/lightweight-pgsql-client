import * as vscode from 'vscode';

const PASSWORD_KEY_PREFIX = 'pgsql.connection.password.';

export class SecretStorageService {
  constructor(private secretStorage: vscode.SecretStorage) {}

  async storePassword(connectionId: string, password: string): Promise<void> {
    const key = PASSWORD_KEY_PREFIX + connectionId;
    await this.secretStorage.store(key, password);
  }

  async getPassword(connectionId: string): Promise<string | undefined> {
    const key = PASSWORD_KEY_PREFIX + connectionId;
    return await this.secretStorage.get(key);
  }

  async deletePassword(connectionId: string): Promise<void> {
    const key = PASSWORD_KEY_PREFIX + connectionId;
    await this.secretStorage.delete(key);
  }

  async hasPassword(connectionId: string): Promise<boolean> {
    const password = await this.getPassword(connectionId);
    return password !== undefined && password !== '';
  }
}

let instance: SecretStorageService | undefined;

export function initSecretStorage(context: vscode.ExtensionContext): SecretStorageService {
  instance = new SecretStorageService(context.secrets);
  return instance;
}

export function getSecretStorage(): SecretStorageService {
  if (!instance) {
    throw new Error('SecretStorageService not initialized');
  }
  return instance;
}
