export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export const HTTP_METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export type BodyType = 'none' | 'json' | 'text' | 'form' | 'urlencoded';

export type AuthType = 'none' | 'bearer' | 'basic' | 'apikey';

export interface AuthConfig {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  addTo?: 'header' | 'query';
}

export interface ApiRequest {
  id: string;
  collectionId: string;
  folder: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  bodyType: BodyType;
  body: string;
  auth: AuthConfig;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface FolderVars {
  name: string;
  variables: KeyValue[];
  headers: KeyValue[];
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  folders: string[];
  folderVars: FolderVars[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  collectionCount: number;
  requestCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface EnvVar {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface Environment {
  id: string;
  name: string;
  variables: EnvVar[];
  createdAt: number;
  updatedAt: number;
}

export interface Workspace {
  version: number;
  projects: ProjectSummary[];
  activeProjectId: string | null;
  collections: Collection[];
  requests: ApiRequest[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  updatedAt: number;
}

export interface RequestInput {
  id?: string;
  collectionId?: string;
  folder?: string;
  name: string;
  method?: HttpMethod;
  url: string;
  params?: Partial<KeyValue>[];
  headers?: Partial<KeyValue>[];
  bodyType?: BodyType;
  body?: string;
  auth?: Partial<AuthConfig>;
  description?: string;
}

export interface SendRequestInput {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface SendResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyKind: 'json' | 'text' | 'binary';
  size: number;
  timeMs: number;
  error?: string;
}

export type ImportFormat = 'openapi' | 'postman' | 'har' | 'curl' | 'apitools';
export type ExportFormat = 'postman' | 'openapi' | 'apitools';

export interface ImportResult {
  collection: Collection;
  imported: number;
  skipped: number;
  warnings: string[];
}

export interface ExportResult {
  format: ExportFormat;
  filename: string;
  content: string;
}

export function emptyAuth(): AuthConfig {
  return { type: 'none' };
}

export function createKeyValue(key = '', value = '', enabled = true): KeyValue {
  return { id: newId('kv'), key, value, enabled };
}

let counter = 0;
export function newId(prefix = 'id'): string {
  counter = (counter + 1) % 100000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createEmptyWorkspace(): Workspace {
  return {
    version: 2,
    projects: [],
    activeProjectId: null,
    collections: [],
    requests: [],
    environments: [],
    activeEnvironmentId: null,
    updatedAt: Date.now(),
  };
}

export function createRequest(input: Partial<ApiRequest> = {}): ApiRequest {
  const now = Date.now();
  return {
    id: input.id ?? newId('req'),
    collectionId: input.collectionId ?? '',
    folder: input.folder ?? '',
    name: input.name ?? '未命名请求',
    method: input.method ?? 'GET',
    url: input.url ?? '',
    params: input.params ?? [],
    headers: input.headers ?? [],
    bodyType: input.bodyType ?? 'none',
    body: input.body ?? '',
    auth: input.auth ?? emptyAuth(),
    description: input.description ?? '',
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}
