import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public props: Props;
  public state: State;

  constructor(props: Props) {
    super(props);
    this.props = props;
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Shinobi UI Crash caught by ErrorBoundary]:', error, errorInfo);
  }

  private handleResetCache = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    window.location.reload();
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0d1117] text-gray-100 flex items-center justify-center p-6 select-none font-sans">
          <div className="max-w-md w-full bg-[#161b22] border border-red-500/30 rounded-xl p-6 shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-2xl">
              ⚠️
            </div>
            <h2 className="text-lg font-bold text-red-400">界面加载遇到异常</h2>
            <p className="text-xs text-gray-400 text-left bg-black/40 p-3 rounded font-mono break-all max-h-32 overflow-y-auto border border-white/5">
              {this.state.error?.message || '未知渲染错误'}
            </p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={this.handleReload}
                className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium cursor-pointer transition-colors"
              >
                重新加载
              </button>
              <button
                onClick={this.handleResetCache}
                className="flex-1 py-2 px-3 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded-lg text-xs font-medium cursor-pointer transition-colors"
              >
                清理缓存重置
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
