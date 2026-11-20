import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installTauriBridge } from './lib/bridge';
import './styles.css';

// 关闭 WebView 默认右键菜单（Reload / Back 等），
// 输入框保留系统菜单方便复制粘贴，其它区域由应用自己的右键菜单处理
document.addEventListener('contextmenu', (event) => {
  const target = event.target as HTMLElement | null;
  if (target && target.closest('input, textarea')) return;
  event.preventDefault();
});

installTauriBridge();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
