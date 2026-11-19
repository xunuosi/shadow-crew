import React, { createContext, useCallback, useContext, useState } from 'react';
import { ArtifactsWindowModal } from '../components/artifacts/ArtifactsWindowModal';
import type { ArtifactsScopeDescriptor } from '../services/artifactsService';

interface ArtifactsWindowContextValue {
  openArtifactsWindow: (scope: ArtifactsScopeDescriptor) => void;
  closeArtifactsWindow: () => void;
  isArtifactsWindowOpen: boolean;
}

const ArtifactsWindowContext = createContext<ArtifactsWindowContextValue | null>(null);

export const ArtifactsWindowProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [activeScope, setActiveScope] = useState<ArtifactsScopeDescriptor | null>(null);

  const openArtifactsWindow = useCallback((scope: ArtifactsScopeDescriptor) => {
    setActiveScope(scope);
  }, []);

  const closeArtifactsWindow = useCallback(() => {
    setActiveScope(null);
  }, []);

  return (
    <ArtifactsWindowContext.Provider
      value={{
        openArtifactsWindow,
        closeArtifactsWindow,
        isArtifactsWindowOpen: activeScope !== null,
      }}
    >
      {children}
      <ArtifactsWindowModal
        isOpen={activeScope !== null}
        scope={activeScope}
        onClose={closeArtifactsWindow}
      />
    </ArtifactsWindowContext.Provider>
  );
};

export function useArtifactsWindow(): ArtifactsWindowContextValue {
  const ctx = useContext(ArtifactsWindowContext);
  if (!ctx) {
    return {
      openArtifactsWindow: () => {},
      closeArtifactsWindow: () => {},
      isArtifactsWindowOpen: false,
    };
  }
  return ctx;
}
