import { QuestionRepository } from './repositories';
import { seedQuestions } from './seed';

export async function bootstrapLocalData(): Promise<void> {
  const questions = new QuestionRepository();
  if ((await questions.count()) === 0) {
    await questions.putMany(seedQuestions);
  }
}
