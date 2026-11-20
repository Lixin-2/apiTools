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

export type FormFieldKind = 'text' | 'file';

export interface FormField {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  kind: FormFieldKind;
  filePath?: string;
  fileName?: string;
  mime?: string;
}

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
  /** bodyType 为 form / urlencoded 时的键值对，支持文件字段 */
  formFields: FormField[];
  auth: AuthConfig;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  /** 目录路径，支持多级，例如 "用户中心/登录" */
  folders: string[];
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
  /** 统一 URL 前缀，例如 https://api.example.com/v1 */
  baseUrl: string;
  /** 统一请求头，发送时自动注入（请求内同名 Header 优先） */
  headers: KeyValue[];
  /** 兼容旧数据的变量表，界面中不再使用 */
  variables?: EnvVar[];
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
  /** 二进制响应落盘后的临时文件路径 */
  filePath?: string;
  fileName?: string;
  mime?: string;
  /** 小图片的 data URL 预览 */
  preview?: string;
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
    formFields: input.formFields ?? [],
    auth: input.auth ?? emptyAuth(),
    description: input.description ?? '',
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}
export interface LoadTestConfig {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  formFields?: FormField[];
  concurrency: number;
  durationMs?: number;
  totalRequests?: number;
  /** 速率模式：不限 / 固定 / 随机区间 */
  rateMode?: 'unlimited' | 'fixed' | 'random';
  targetRps?: number;
  minRps?: number;
  maxRps?: number;
  /** 随机模式重新采样间隔（秒） */
  rpsChangeSecs?: number;
  rampUpMs?: number;
  timeoutMs?: number;
}

export interface LoadTestSnapshot {
  running: boolean;
  elapsedMs: number;
  total: number;
  success: number;
  failed: number;
  errors: Record<string, number>;
  statusClasses: Record<string, number>;
  qps: number;
  avgMs: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  minMs: number;
  maxMs: number;
  bytesPerSec: number;
  buckets: [number, number][];
  slowest: { ms: number; status: number; error?: string }[];
  concurrency: number;
  /** 当前生效的目标 TPS（0 = 不限速） */
  targetRps: number;
}
