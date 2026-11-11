import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { FilePreviewDrawer, FilePreviewTarget } from '../components/FilePreviewDrawer';
import { parseFileLink } from '../services/fileViewerService';

interface FilePreviewContextValue {
  isOpen: boolean;
  activeTarget: FilePreviewTarget | null;
  openFilePreview: (target: string | FilePreviewTarget, workspaceRoot?: string) => void;
  closeFilePreview: () => void;
}

const FilePreviewContext = createContext<FilePreviewContextValue | null>(null);

export interface FilePreviewProviderProps {
  children: React.ReactNode;
  defaultWorkspaceRoot?: string;
}

export const FilePreviewProvider: React.FC<FilePreviewProviderProps> = ({
  children,
  defaultWorkspaceRoot,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTarget, setActiveTarget] = useState<FilePreviewTarget | null>(null);

  const openFilePreview = useCallback(
    (target: string | FilePreviewTarget, workspaceRoot?: string) => {
      const root = workspaceRoot || defaultWorkspaceRoot;
      if (typeof target === 'string') {
        const parsed = parseFileLink(target);
        setActiveTarget({
          rawPath: parsed.raw || target,
          startLine: parsed.startLine,
          endLine: parsed.endLine,
          workspaceRoot: root,
        });
      } else {
        setActiveTarget({
          ...target,
          workspaceRoot: target.workspaceRoot || root,
        });
      }
      setIsOpen(true);
    },
    [defaultWorkspaceRoot]
  );

  const closeFilePreview = useCallback(() => {
    setIsOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      isOpen,
      activeTarget,
      openFilePreview,
      closeFilePreview,
    }),
    [isOpen, activeTarget, openFilePreview, closeFilePreview]
  );

  return (
    <FilePreviewContext.Provider value={value}>
      {children}
      <FilePreviewDrawer
        isOpen={isOpen}
        onClose={closeFilePreview}
        target={activeTarget}
      />
    </FilePreviewContext.Provider>
  );
};

export function useFilePreview(): FilePreviewContextValue {
  const ctx = useContext(FilePreviewContext);
  if (!ctx) {
    // 降级兜底方案：在无 Provider 环境下不抛异常，优雅保持空操作
    return {
      isOpen: false,
      activeTarget: null,
      openFilePreview: (target) => {
        console.warn('[useFilePreview] FilePreviewProvider is not mounted in the ancestor tree:', target);
      },
      closeFilePreview: () => {},
    };
  }
  return ctx;
}
