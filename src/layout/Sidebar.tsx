import type { SidebarSection, SidebarSectionId } from "./sidebarModel";

interface SidebarProps {
  sections: SidebarSection[];
  selected: SidebarSectionId;
  onSelect(id: SidebarSectionId): void;
}

export function Sidebar({ sections, selected, onSelect }: SidebarProps) {
  return (
    <nav className="tack-sidebar" aria-label="Sections">
      <ul>
        {sections.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              className="tack-sidebar-item"
              aria-current={section.id === selected ? "true" : undefined}
              onClick={() => onSelect(section.id)}
            >
              <span>{section.label}</span>
              <span className="tack-count">{section.notes.length}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
