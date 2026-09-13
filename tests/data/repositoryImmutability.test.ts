import { afterEach, describe, expect, it } from 'vitest';
import { QbtDatabase } from '../../src/data/db';
import { QuestionRepository } from '../../src/data/repositories';
import { makeQuestionV1 } from '../fixtures/questionV1';

const databases: QbtDatabase[] = [];

function createDatabase(name: string): QbtDatabase {
  const database = new QbtDatabase(name);
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close();
    await database.delete();
  }));
});

describe('QuestionRepository revision immutability', () => {
  it('rejects an overwrite of an existing questionId+revisionId and preserves the original revision', async () => {
    const database = createDatabase('qbt-revision-immutability');
    const repository = new QuestionRepository(database);
    const original = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });
    await repository.putMany([original]);

    const changed = makeQuestionV1({
      questionId: 'q',
      revisionId: 'r1',
      revision: 1,
      answers: {
        ...original.answers,
        primaryAnswer: { ...original.answers.primaryAnswer, text: 'Changed' },
      },
    });

    await expect(repository.putMany([changed])).rejects.toThrow('immutable');
    const stored = await repository.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.answers.primaryAnswer.text).toBe('Answer');
  });

  it('allows the same revisionId under different questionIds because identity is composite', async () => {
    const database = createDatabase('qbt-composite-revision-identity');
    const repository = new QuestionRepository(database);
    await repository.putMany([
      makeQuestionV1({ questionId: 'q1', revisionId: 'r1', revision: 1 }),
      makeQuestionV1({ questionId: 'q2', revisionId: 'r1', revision: 1 }),
    ]);
    expect(await repository.count()).toBe(2);
  });

  it('allows the same logical question to be stored as a new revisionId and new revision number', async () => {
    const database = createDatabase('qbt-new-revision');
    const repository = new QuestionRepository(database);
    await repository.putMany([makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 })]);
    await repository.putMany([makeQuestionV1({ questionId: 'q', revisionId: 'r2', revision: 2 })]);

    expect(await repository.count()).toBe(2);
  });

  it('rejects a duplicate numeric revision for the same questionId even when revisionId differs', async () => {
    const database = createDatabase('qbt-numeric-revision-immutability');
    const repository = new QuestionRepository(database);
    await repository.putMany([makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 })]);

    await expect(
      repository.putMany([makeQuestionV1({ questionId: 'q', revisionId: 'alternate-id', revision: 1 })]),
    ).rejects.toThrow('numeric revision');
    expect(await repository.count()).toBe(1);
  });

  it('rejects duplicate revisionIds for the same questionId inside one input batch atomically', async () => {
    const database = createDatabase('qbt-duplicate-batch');
    const repository = new QuestionRepository(database);
    const question = makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 });

    await expect(repository.putMany([question, question])).rejects.toThrow('duplicate');
    expect(await repository.count()).toBe(0);
  });

  it('rejects duplicate numeric revisions inside one input batch atomically', async () => {
    const database = createDatabase('qbt-duplicate-numeric-batch');
    const repository = new QuestionRepository(database);

    await expect(repository.putMany([
      makeQuestionV1({ questionId: 'q', revisionId: 'r1', revision: 1 }),
      makeQuestionV1({ questionId: 'q', revisionId: 'alternate-id', revision: 1 }),
    ])).rejects.toThrow('numeric revisions');
    expect(await repository.count()).toBe(0);
  });
});
