import { createContext, useContext, useEffect, useState } from 'react';

// The rail shows the open sheet's context. Rather than re-fetching what the sheet
// already has, each sheet publishes its own summary here while it is mounted.
const RailContext = createContext({ content: null, publish: () => {} });

export function RailProvider({ children }) {
  const [content, setContent] = useState(null);
  return <RailContext.Provider value={{ content, publish: setContent }}>{children}</RailContext.Provider>;
}

export const useRailContent = () => useContext(RailContext).content?.node ?? null;

export function useRail(render, deps) {
  const { publish } = useContext(RailContext);

  useEffect(() => {
    publish({ node: render() });
    return () => publish(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
