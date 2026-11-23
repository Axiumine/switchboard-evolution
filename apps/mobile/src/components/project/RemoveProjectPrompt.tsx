import { TextPrompt } from '@/components/TextPrompt';
import { removeProject } from '@/projects/flows';
import type { Project } from '@/projects/model';
import { isRemoveProjectWord, REMOVE_PROJECT_WORD, removeProjectQuestion } from '@/projects/settings';

/** Remove project…: the project goes only once "delete" is typed, as on the desktop. `after` runs once it is gone. */
export function RemoveProjectPrompt({ project, visible, onClose, after }: { project: Project; visible: boolean; onClose: () => void; after?: () => void }) {
  const question = removeProjectQuestion(project);
  return (
    <TextPrompt
      visible={visible}
      title={question.title}
      message={question.message}
      placeholder={REMOVE_PROJECT_WORD}
      confirm="Remove"
      destructive
      autoCapitalize="none"
      canSubmit={isRemoveProjectWord}
      onClose={onClose}
      onSubmit={(value) => { if (isRemoveProjectWord(value)) removeProject(project, after); }}
    />
  );
}
