import { describe, expect, it } from '@jest/globals';

import { knowledgeChangedKeys } from '../connection';

describe('knowledgeChangedKeys', () => {
  it('a project\'s change reads that project\'s Node Knowledge again', () => {
    expect(knowledgeChangedKeys({ projectId: 'p1', reason: 'job' })).toEqual([['knowledge', 'p1'], ['knowledge-data', 'p1']]);
  });

  it('a change of CBM\'s settings or program also reads Settings › Node Knowledge again', () => {
    const all = [['knowledge'], ['knowledge-data'], ['knowledge-config'], ['knowledge-binary']];
    for (const reason of ['config', 'binary', 'download', 'latest']) {
      expect(knowledgeChangedKeys({ projectId: null, reason })).toEqual(all);
    }
    expect(knowledgeChangedKeys(undefined)).toEqual(all);
  });
});
