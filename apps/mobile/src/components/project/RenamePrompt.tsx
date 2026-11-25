import { TextPrompt } from '@/components/TextPrompt';
import type { Rename, Run } from './actions';

/** Typing a name: the project's, a track's, or a new track's. Nothing is sent when the name is empty or the same. */
export function RenamePrompt({ rename, run, onClose }: { rename: Rename | null; run: Run; onClose: () => void }) {
  return (
    <TextPrompt
      visible={!!rename}
      title={rename?.kind === 'new-track' ? 'New track' : 'Rename'}
      initialValue={rename?.name || ''}
      confirm={rename?.kind === 'new-track' ? 'Create' : 'Rename'}
      onClose={onClose}
      onSubmit={(name) => {
        if (!rename || !name || name === rename.name) return;
        if (rename.kind === 'project') run('update-project', [rename.id, { name }]);
        else if (rename.kind === 'track') run('update-track', [rename.id, { name }]);
        else run('create-track', [rename.id, { name }]);
      }}
    />
  );
}
