import type {
  ApiRequest,
  Collection,
  Environment,
  ExportFormat,
  FolderVars,
  ImportFormat,
  KeyValue,
  ProjectSummary,
  SendResponse,
  Workspace,
} from '../shared/types';

export interface AppInfo {
  name: string;
  version: string;
  port: number;
  token: string;
  dataDir: string;
  dataFile: string;
  mcpServerPath: string;
  mcpCommand: string;
}

export interface ImportOutcome {
  format: ImportFormat;
  collection: Collection;
  imported: number;
  skipped: number;
  warnings: string[];
  filePath?: string;
}

export interface ApiToolsApi {
  getAppInfo(): Promise<AppInfo>;
  readWorkspace(): Promise<Workspace>;
  replaceWorkspace(ws: Workspace): Promise<Workspace>;
  createCollection(name: string, description?: string): Promise<Collection>;
  updateCollection(id: string, patch: Partial<Collection>): Promise<Collection | null>;
  deleteCollection(id: string): Promise<boolean>;
  createFolder(collectionId: string, name: string): Promise<string[]>;
  renameFolder(collectionId: string, oldName: string, newName: string): Promise<string[]>;
  deleteFolder(collectionId: string, name: string): Promise<string[]>;
  setFolderConfig(
    collectionId: string,
    name: string,
    variables: KeyValue[],
    headers: KeyValue[],
  ): Promise<FolderVars>;
  createProject(name: string, description?: string): Promise<ProjectSummary>;
  renameProject(id: string, name: string, description?: string): Promise<void>;
  deleteProject(id: string): Promise<boolean>;
  setActiveProject(id: string): Promise<void>;
  saveRequest(input: Partial<ApiRequest>): Promise<ApiRequest>;
  deleteRequest(id: string): Promise<boolean>;
  getRequest(id: string): Promise<ApiRequest | null>;
  sendRequest(payload: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }): Promise<SendResponse>;
  importText(payload: {
    content: string;
    format?: ImportFormat;
    collectionName?: string;
    mode?: 'merge' | 'replace';
  }): Promise<ImportOutcome>;
  importFile(payload?: { format?: ImportFormat; collectionName?: string }): Promise<ImportOutcome | null>;
  exportCollection(payload: {
    collectionId: string;
    format: ExportFormat;
    toFile?: boolean;
  }): Promise<{ filename: string; content: string; filePath?: string } | null>;
  exportWorkspace(payload?: { toFile?: boolean }): Promise<{ filename: string; content: string; filePath?: string } | null>;
  saveEnvironment(env: Partial<Environment>): Promise<Environment>;
  deleteEnvironment(id: string): Promise<boolean>;
  setActiveEnvironment(id: string | null): Promise<void>;
  openDataDir(): Promise<string>;
  openExternal(url: string): Promise<void>;
  onWorkspaceChanged(callback: () => void): () => void;
}

declare global {
  interface Window {
    api: ApiToolsApi;
  }
}

export {};
