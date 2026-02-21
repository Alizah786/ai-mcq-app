import { createContext, useContext, useState } from "react";

const SidebarRefreshContext = createContext(null);

export function SidebarRefreshProvider({ children }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const triggerRefresh = () => setRefreshKey((k) => k + 1);
  return (
    <SidebarRefreshContext.Provider value={{ refreshKey, triggerRefresh }}>
      {children}
    </SidebarRefreshContext.Provider>
  );
}

export function useSidebarRefresh() {
  const ctx = useContext(SidebarRefreshContext);
  return ctx;
}
