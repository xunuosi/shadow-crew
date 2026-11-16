import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ThemeProvider } from './context/ThemeContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installSprtDevBridge } from './services/cogno/sprtTraceRecorder';

// Dev 运行期调试桥：导出真实 SPRT trace / 设置外置阈值（生产构建自动跳过）。
installSprtDevBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);

