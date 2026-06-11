import { createContext, useContext, useState, ReactNode } from "react";

type ProjectContextType = {
  selectedProjectId: number | null;
  setSelectedProjectId: (id: number | null) => void;
};

const ProjectContext = createContext<ProjectContextType>({
  selectedProjectId: null,
  setSelectedProjectId: () => {},
});

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(() => {
    const saved = localStorage.getItem("selectedProjectId");
    return saved ? parseInt(saved, 10) : null;
  });

  const handleSetProjectId = (id: number | null) => {
    setSelectedProjectId(id);
    if (id) {
      localStorage.setItem("selectedProjectId", id.toString());
    } else {
      localStorage.removeItem("selectedProjectId");
    }
  };

  return (
    <ProjectContext.Provider value={{ selectedProjectId, setSelectedProjectId: handleSetProjectId }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  return useContext(ProjectContext);
}
