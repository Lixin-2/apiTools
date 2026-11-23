import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ApiToolsApi } from '../global';

function onWorkspaceChanged(callback: () => void): () => void {
  let unlisten: (() => void) | null = null;
  let stopped = false;
  listen('workspace:changed', () => callback()).then((fn) => {
    if (stopped) fn();
    else unlisten = fn;
  });
  return () => {
    stopped = true;
    unlisten?.();
  };
}

export function installTauriBridge(): void {
  const api: ApiToolsApi = {
    getAppInfo: () => invoke('app_info'),
    setDockIcon: (dark) => invoke('set_dock_icon', { dark }),
    getSettings: () => invoke('get_settings'),
    updateMcpSettings: (payload) => invoke('update_mcp_settings', { enabled: payload.enabled, port: payload.port }),
    readWorkspace: () => invoke('read_workspace'),
    replaceWorkspace: (ws) => invoke('replace_workspace', { workspace: ws }),
    createCollection: (name, description = '') => invoke('create_collection', { name, description }),
    updateCollection: (id, patch) => invoke('update_collection', { id, patch }),
    deleteCollection: (id) => invoke('delete_collection', { id }),
    createFolder: (collectionId, name) => invoke('create_folder', { collectionId, name }),
    renameFolder: (collectionId, oldName, newName) =>
      invoke('rename_folder', { collectionId, oldName, newName }),
    deleteFolder: (collectionId, name) => invoke('delete_folder', { collectionId, name }),

    createProject: (name, description = '') => invoke('create_project', { name, description }),
    renameProject: (id, name, description) => invoke('rename_project', { id, name, description }),
    deleteProject: (id) => invoke('delete_project', { id }),
    setActiveProject: (id) => invoke('set_active_project', { id }),
    saveRequest: (input) => invoke('save_request', { input }),
    deleteRequest: (id) => invoke('delete_request', { id }),
    getRequest: (id) => invoke('get_request', { id }),
    sendRequest: (payload) => invoke('send_request', { payload }),
    pickFile: (options) =>
      invoke('pick_file', {
        title: options?.title,
        extensions: options?.extensions,
      }),
    inspectBodyPool: (path) => invoke('inspect_body_pool', { path }),
    saveResponseFile: (payload) => invoke('save_response_file', payload),
    downloadResponseFile: (payload) => invoke('download_response_file', payload),
    revealPath: (path) => invoke('reveal_path', { path }),
    startLoadTest: (config) => invoke('start_load_test', { config }),
    stopLoadTest: () => invoke('stop_load_test'),
    onLoadTestProgress: (handler) =>
      listen('loadtest-progress', (event: any) => handler(event.payload)),
    onLoadTestFinished: (handler) =>
      listen('loadtest-finished', (event: any) => handler(event.payload)),
    importText: (payload) => invoke('import_text', { payload }),
    importFile: (payload) => invoke('import_file', { payload: payload ?? {} }),
    exportCollection: (payload) => invoke('export_collection', { payload }),
    exportWorkspace: (payload) => invoke('export_workspace', { payload: payload ?? {} }),
    saveEnvironment: (env) => invoke('save_environment', { env }),
    deleteEnvironment: (id) => invoke('delete_environment', { id }),
    setActiveEnvironment: (id) => invoke('set_active_environment', { id }),
    openDataDir: () => invoke('open_data_dir'),
    openExternal: (url) => invoke('open_external', { url }),
    onWorkspaceChanged,
  };

  (window as unknown as { api: ApiToolsApi }).api = api;
}
