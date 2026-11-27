import { TabBar } from '@/components/TabBar';
import { PROJECT_TABS, type ProjectTab } from '@/projects/tabs';

/**
 * The project page's tabs: the generic TabBar with the project's tabs as its
 * default. `tabs` leaves some out (Session until one is open).
 */
export function ProjectTabBar({ tabs = PROJECT_TABS, ...props }: {
  tabs?: readonly { key: ProjectTab; label: string }[];
  active: ProjectTab;
  onChange: (tab: ProjectTab) => void;
  meta?: Partial<Record<ProjectTab, string>>;
  dots?: Partial<Record<ProjectTab, string>>;
  onPopOut?: (tab: ProjectTab) => void;
  popOut?: readonly ProjectTab[];
}) {
  return <TabBar tabs={tabs} {...props} />;
}
