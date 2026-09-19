import { afterEach, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { StudyState } from '../src/domain/types';
import { createBackup, parseBackupJson, serializeBackup } from '../src/backup/backup';
import { QbtDatabase, toQuestionRecord } from '../src/data/db';
import { createAttempt } from '../src/engine/attemptFactory';
import { createSessionRecord, endSessionRecord } from '../src/engine/sessionFactory';
import { seedQuestions } from '../src/data/seed';

const dbs: QbtDatabase[] = [];
const evidence = resolve(process.env.EVIDENCE_DIR ?? '../evidence', 'AC-07');
const makeDb=(name:string)=>{const db=new QbtDatabase(name);dbs.push(db);return db;};
const state=(q:string,r:string):StudyState=>({questionId:q,revisionId:r,dueAt:'2026-09-20T00:00:00.000Z',intervalDays:1,easeFactor:2.5,repetitions:1,lapses:0,bestBuzzIndex:2,bestBuzzRatio:0.5,bestResponseTimeMs:300,correctCount:1,attemptCount:1,streak:1});
async function seed(db:QbtDatabase,prefix:string){
  const q=seedQuestions[0]!;
  const s=createSessionRecord({sessionId:`${prefix}-session`,mode:'normal',startedAt:'2026-09-19T00:00:00.000Z',targetQuestionCount:1});
  const a=createAttempt({attemptId:`${prefix}-attempt`,question:q,sessionId:s.sessionId,mode:'normal',outcome:'correct',judge:{kind:'canonical',isCorrect:true,normalizedSubmitted:'富士山',matchedAnswer:'富士山'},submittedAnswer:'富士山',startedAt:'2026-09-19T00:00:01.000Z',completedAt:'2026-09-19T00:00:02.000Z',buzz:{buzzIndex:2,totalGraphemeCount:q.derived.graphemeCount,buzzRatio:2/q.derived.graphemeCount,visibleText:'日本',buzzTimeMs:200,buzzAtMs:200},responseTimeMs:300});
  const ended=endSessionRecord(s,'completed',a.completedAt,{consumedQuestionCount:1});
  await db.questions.add(toQuestionRecord(q)); await db.attempts.add(a); await db.studyStates.add(state(q.questionId,q.revisionId)); await db.sessions.add(ended); await db.settings.add({key:`${prefix}-setting`,value:{enabled:true}});
}
afterEach(async()=>{await Promise.all(dbs.splice(0).map(async db=>{db.close();await db.delete();}));});
it('AC-07 Backup Round Trip',async()=>{
  await mkdir(evidence,{recursive:true}); const db=makeDb('qbt-rv-ac07'); await seed(db,'source');
  const backup=await createBackup(db); const serialized=serializeBackup(backup); const parsed=parseBackupJson(serialized);
  const counts=Object.fromEntries(Object.entries(backup.data).map(([k,v])=>[k,(v as unknown[]).length]));
  const parsedCounts=Object.fromEntries(Object.entries(parsed.data).map(([k,v])=>[k,(v as unknown[]).length]));
  const pass=backup.format==='qbt-backup'&&backup.version===1&&typeof backup.exportedAt==='string'&&backup.appVersion.length>0&&backup.dbSchemaVersion>=1&&backup.questionDataVersion.length>0&&JSON.stringify(counts)===JSON.stringify(parsedCounts);
  await writeFile(resolve(evidence,'ac07-backup.json'),serialized);
  await writeFile(resolve(evidence,'ac07-source-counts.json'),JSON.stringify(counts,null,2)+'\n');
  await writeFile(resolve(evidence,'ac07-validation-report.json'),JSON.stringify({ac:'AC-07',pass,metadata:{format:backup.format,version:backup.version,exportedAt:backup.exportedAt,appVersion:backup.appVersion,dbSchemaVersion:backup.dbSchemaVersion,questionDataVersion:backup.questionDataVersion},sourceCounts:counts,parsedCounts},null,2)+'\n');
  expect(pass).toBe(true);
});
