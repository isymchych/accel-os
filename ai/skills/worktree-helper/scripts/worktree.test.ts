import { describe, expect, it } from 'vitest';

import {
  buildWorktreeListRows,
  evaluateCreateCollision,
  formatExistingLocalBranchConflict,
  formatDisplayPath,
  getBranchDeletionFlag,
  getComparisonRef,
  getWorktreePathKind,
  hasChanges,
  isExplicitRemoteBranchRequest,
  isReusableExistingWorktree,
  parseArgs,
  resolveCreateWorktreePath,
  resolvePrHeadSource,
  resolveRemovalTarget,
  resolveRemoteBranchFromRefs,
  sanitizePathToken,
  toYesNo,
} from './worktree.ts';

describe('worktree helper pure logic', () => {
  describe('parseArgs', () => {
    it('parses create flags including dry-run and path override', () => {
      expect(
        parseArgs([
          'new-branch',
          'feature/test',
          '--from',
          'origin/main',
          '--path',
          'custom/worktree',
          '--dry-run',
          '--no-setup',
        ]),
      ).toMatchObject({
        command: 'new-branch',
        positional: ['feature/test'],
        fromRef: 'origin/main',
        pathOverride: 'custom/worktree',
        dryRun: true,
        runSetup: false,
      });
    });

    it('rejects empty path overrides', () => {
      expect(() => parseArgs(['checkout', 'main', '--path='])).toThrow(
        'Option "--path" requires a directory value.',
      );
    });

    it('parses remove dry-run flags', () => {
      expect(parseArgs(['remove', '../PAB-demo', '--force', '--dry-run'])).toMatchObject({
        command: 'remove',
        positional: ['../PAB-demo'],
        force: true,
        dryRun: true,
      });
    });

    it('parses list json mode', () => {
      expect(parseArgs(['list', '--json'])).toMatchObject({
        command: 'list',
        positional: [],
        json: true,
      });
    });
  });

  describe('resolveRemoteBranchFromRefs', () => {
    const remoteRefs = [
      'origin/main',
      'origin/change-rank',
      'origin/1331-інструмент-слідкування-за-виплатами-по-контракту-18/24',
      'upstream/change-rank',
    ];

    it('accepts slash-named remote branches by branch name', () => {
      expect(
        resolveRemoteBranchFromRefs(
          remoteRefs,
          '1331-інструмент-слідкування-за-виплатами-по-контракту-18/24',
        ),
      ).toEqual({
        remoteRef: 'origin/1331-інструмент-слідкування-за-виплатами-по-контракту-18/24',
        localBranchName: '1331-інструмент-слідкування-за-виплатами-по-контракту-18/24',
      });
    });

    it('rejects ambiguous branch names across remotes', () => {
      expect(() => resolveRemoteBranchFromRefs(remoteRefs, 'change-rank')).toThrow(
        'matches multiple remote branches',
      );
    });

    it('preserves explicit remote refs', () => {
      expect(resolveRemoteBranchFromRefs(remoteRefs, 'origin/change-rank')).toEqual({
        remoteRef: 'origin/change-rank',
        localBranchName: 'change-rank',
      });
    });

    it('treats explicit remote checkout requests as remote-first', () => {
      expect(
        isExplicitRemoteBranchRequest('origin/change-rank', {
          remoteRef: 'origin/change-rank',
        }),
      ).toBe(true);
      expect(
        isExplicitRemoteBranchRequest('change-rank', {
          remoteRef: 'origin/change-rank',
        }),
      ).toBe(false);
    });

    it('returns null when no remote branch matches', () => {
      expect(resolveRemoteBranchFromRefs(remoteRefs, 'missing-branch')).toBeNull();
    });
  });

  describe('path planning helpers', () => {
    it('uses sibling default worktree paths', () => {
      expect(resolveCreateWorktreePath('/parent/PAB', '../PAB-demo', null)).toBe(
        '/parent/PAB-demo',
      );
    });

    it('resolves custom relative worktree paths from the repo root', () => {
      expect(resolveCreateWorktreePath('/repo', '../repo-demo', 'tmp/demo')).toBe('/repo/tmp/demo');
    });

    it('preserves absolute custom worktree paths', () => {
      expect(resolveCreateWorktreePath('/repo', '../repo-demo', '/tmp/custom-demo')).toBe(
        '/tmp/custom-demo',
      );
    });

    it('sanitizes detached ref tokens predictably', () => {
      expect(sanitizePathToken('feature/foo bar')).toBe('feature-foo-bar');
    });

    it('falls back to ref when sanitization removes every character', () => {
      expect(sanitizePathToken('🔥/💥')).toBe('ref');
    });
  });

  describe('PR and detached semantics', () => {
    it('always uses the fetched remote PR head as the source ref', () => {
      expect(resolvePrHeadSource('change-rank')).toBe('origin/change-rank');
    });

    it('formats local-branch conflicts explicitly for remote and PR flows', () => {
      expect(
        formatExistingLocalBranchConflict('change-rank', 'remote ref origin/change-rank'),
      ).toContain('Local branch "change-rank" already exists');
      expect(
        formatExistingLocalBranchConflict('change-rank', 'fetched PR head origin/change-rank'),
      ).toContain('refusing to create or reuse it');
    });

    it('uses HEAD as the detached comparison ref', () => {
      expect(getComparisonRef({ path: '/parent/repo-detached-abc', detached: true })).toBe(
        'HEAD',
      );
    });

    it('uses origin/main when a branch has no upstream', () => {
      expect(getComparisonRef({ path: '/parent/repo-release-fix', detached: false }, null)).toBe(
        'origin/main',
      );
    });
  });

  describe('removal and display helpers', () => {
    const branchStatus = {
      worktree: {
        path: '/parent/repo-change-rank',
        head: 'abc',
        branchRef: 'refs/heads/change-rank',
        branchName: 'change-rank',
        detached: false,
      },
      isCurrent: false,
      isPrimary: false,
      dirty: false,
      untracked: false,
      localCommits: 0,
      upstreamRef: null,
      comparisonRef: 'origin/change-rank',
    };

    const detachedStatus = {
      worktree: {
        path: '/parent/repo-detached-abc',
        head: 'abc',
        branchRef: null,
        branchName: null,
        detached: true,
      },
      isCurrent: false,
      isPrimary: false,
      dirty: true,
      untracked: false,
      localCommits: 0,
      upstreamRef: null,
      comparisonRef: 'HEAD',
    };

    it('resolves removal target by branch name before path', () => {
      expect(resolveRemovalTarget([branchStatus, detachedStatus], '/repo', 'change-rank')).toBe(
        branchStatus,
      );
    });

    it('resolves removal target by exact path when no branch matches', () => {
      expect(
        resolveRemovalTarget([branchStatus, detachedStatus], '/repo', '/parent/repo-detached-abc'),
      ).toBe(detachedStatus);
    });

    it('reports changed status from dirty, untracked, or local commits', () => {
      expect(hasChanges(branchStatus)).toBe(false);
      expect(hasChanges({ ...detachedStatus, dirty: false })).toBe(true);
      expect(hasChanges({ ...branchStatus, untracked: true })).toBe(true);
      expect(hasChanges({ ...branchStatus, localCommits: 2 })).toBe(true);
    });

    it('forces branch deletion when unpublished commits are present', () => {
      expect(getBranchDeletionFlag({ ...branchStatus, localCommits: 0 }, false)).toBe('-d');
      expect(getBranchDeletionFlag({ ...branchStatus, localCommits: 2 }, false)).toBe('-D');
      expect(getBranchDeletionFlag({ ...branchStatus, localCommits: 0 }, true)).toBe('-D');
    });

    it('detects reusable branch and detached worktrees', () => {
      expect(
        isReusableExistingWorktree(branchStatus.worktree, {
          kind: 'branch',
          worktreePath: '/parent/repo-change-rank',
          branchName: 'change-rank',
          createArgs: [],
          displaySource: 'change-rank',
        }),
      ).toBe(true);

      expect(
        isReusableExistingWorktree(detachedStatus.worktree, {
          kind: 'detached',
          worktreePath: '/parent/repo-detached-abc',
          resolvedCommit: 'abc',
          requestedRef: 'abc',
          createArgs: [],
          displaySource: 'abc',
        }),
      ).toBe(true);
    });

    it('formats display paths and yes/no values predictably', () => {
      expect(formatDisplayPath('/repo', '/parent/repo-change-rank')).toBe('/parent/repo-change-rank');
      expect(formatDisplayPath('/repo', '/tmp/external')).toBe('/tmp/external');
      expect(getWorktreePathKind('/repo', branchStatus.worktree)).toBe('custom');
      expect(
        getWorktreePathKind('/repo', {
          ...branchStatus.worktree,
          path: '/repo/.tmp-worktrees/change-rank',
        }),
      ).toBe('custom');
      expect(
        getWorktreePathKind('/parent/repo', {
          ...branchStatus.worktree,
          path: '/parent/repo-change-rank',
        }),
      ).toBe('default');
      expect(toYesNo(true)).toBe('yes');
      expect(toYesNo(false)).toBe('no');
    });

    it('builds richer list rows', () => {
      expect(buildWorktreeListRows('/repo', [branchStatus, detachedStatus])).toEqual([
        {
          branch: 'change-rank',
          source: 'branch',
          pathKind: 'custom',
          upstream: '(none)',
          comparison: 'origin/change-rank',
          path: '/parent/repo-change-rank',
          dirty: 'no',
          untracked: 'no',
          localCommits: '0',
          current: 'no',
          primary: 'no',
        },
        {
          branch: '(detached)',
          source: 'detached',
          pathKind: 'custom',
          upstream: '(none)',
          comparison: 'HEAD',
          path: '/parent/repo-detached-abc',
          dirty: 'yes',
          untracked: 'no',
          localCommits: 'n/a',
          current: 'no',
          primary: 'no',
        },
      ]);
    });
  });

  describe('creation collision helpers', () => {
    const existingBranchWorktree = {
      path: '/parent/repo-change-rank',
      head: 'abc',
      branchRef: 'refs/heads/change-rank',
      branchName: 'change-rank',
      detached: false,
    };

    const otherBranchWorktree = {
      path: '/parent/repo-other-branch',
      head: 'def',
      branchRef: 'refs/heads/other-branch',
      branchName: 'other-branch',
      detached: false,
    };

    const detachedWorktree = {
      path: '/parent/repo-detached-abc',
      head: 'abc',
      branchRef: null,
      branchName: null,
      detached: true,
    };

    it('reuses an existing worktree at the same path for the same branch target', () => {
      expect(
        evaluateCreateCollision([existingBranchWorktree], {
          kind: 'branch',
          worktreePath: '/parent/repo-change-rank',
          branchName: 'change-rank',
          createArgs: [],
          displaySource: 'change-rank',
        }),
      ).toEqual({
        kind: 'reuse-existing',
        existingWorktree: existingBranchWorktree,
      });
    });

    it('reports a path conflict when the path is already used by another target', () => {
      expect(
        evaluateCreateCollision([otherBranchWorktree], {
          kind: 'branch',
          worktreePath: '/parent/repo-other-branch',
          branchName: 'change-rank',
          createArgs: [],
          displaySource: 'change-rank',
        }),
      ).toEqual({
        kind: 'path-conflict',
        existingWorktree: otherBranchWorktree,
      });
    });

    it('reports a branch conflict when the branch is checked out elsewhere', () => {
      expect(
        evaluateCreateCollision([existingBranchWorktree], {
          kind: 'branch',
          worktreePath: '/parent/custom-change-rank',
          branchName: 'change-rank',
          createArgs: [],
          displaySource: 'change-rank',
        }),
      ).toEqual({
        kind: 'branch-conflict',
        existingWorktree: existingBranchWorktree,
      });
    });

    it('reuses a detached worktree for the same resolved commit', () => {
      expect(
        evaluateCreateCollision([detachedWorktree], {
          kind: 'detached',
          worktreePath: '/parent/repo-detached-abc',
          resolvedCommit: 'abc',
          requestedRef: 'abc',
          createArgs: [],
          displaySource: 'abc',
        }),
      ).toEqual({
        kind: 'reuse-existing',
        existingWorktree: detachedWorktree,
      });
    });

    it('returns create-new when neither path nor branch collides', () => {
      expect(
        evaluateCreateCollision([existingBranchWorktree], {
          kind: 'branch',
          worktreePath: '/parent/repo-new-branch',
          branchName: 'new-branch',
          createArgs: [],
          displaySource: 'HEAD',
        }),
      ).toEqual({
        kind: 'create-new',
      });
    });
  });
});
