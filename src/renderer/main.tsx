import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installTauriBridge } from './lib/bridge';
import './styles.css';

installTauriBridge();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
