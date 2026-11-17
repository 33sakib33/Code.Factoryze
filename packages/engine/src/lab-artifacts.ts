import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { labSyncSchema, labSubmitSchema, labClientEventSchema, labSubmissionSchema, practiceReportSchema,
  gradingProvenanceSchema,type GradingProvenance,type LabFile, type LabTaskBundle, type LabMirror, type LabSubmission, type PracticeReport } from '@factoryze/protocol';
import { labFilesHash, validateLabFiles } from './lab-files.ts';

export type GradeSnapshot = { id: string; lab: string; member: string; files: LabFile[]; hidden: LabFile[]; task: LabTaskBundle['task'] };
export type LabGradeVerdict={passed:number;total:number;checks?:{name:string;passed:boolean;message?:string}[];provenance?:GradingProvenance};
export type LabGrader=((snapshot:GradeSnapshot)=>Promise<LabGradeVerdict>)&{image?:string};
type SubmissionRow = { id:string; member:string; lab:string; number:number; revision:number; hash:string; at:string; state:string; released_at:string|null; report:string|null; files:string; usage:string };
const receipt = (row: SubmissionRow) => labSubmissionSchema.parse({id:row.id,number:row.number,revision:row.revision,snapshotHash:row.hash,submittedAt:row.at,state:row.state,released:!!row.released_at});
export class LabArtifacts {
  private readonly db: DatabaseSync;
  constructor(file:string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
    if (version > 3) {this.db.close();throw Error('Unsupported lab artifact database');}
    if (!version) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE tasks (lab TEXT PRIMARY KEY, public TEXT NOT NULL, hidden TEXT NOT NULL);
      CREATE TABLE mirrors (member TEXT PRIMARY KEY, lab TEXT NOT NULL, revision INTEGER NOT NULL, hash TEXT NOT NULL, files TEXT NOT NULL);
      CREATE TABLE syncs (member TEXT, id TEXT, body_hash TEXT NOT NULL, ack TEXT NOT NULL, PRIMARY KEY(member,id));
      CREATE TABLE submissions (id TEXT PRIMARY KEY, member TEXT NOT NULL, lab TEXT NOT NULL, number INTEGER NOT NULL,
        revision INTEGER NOT NULL, hash TEXT NOT NULL, at TEXT NOT NULL, state TEXT NOT NULL, released_at TEXT, report TEXT, files TEXT NOT NULL, usage TEXT NOT NULL, UNIQUE(member,number));
      CREATE TABLE submits (member TEXT, id TEXT, revision INTEGER, submission TEXT NOT NULL, PRIMARY KEY(member,id));
      CREATE TABLE client_events (member TEXT, id TEXT, event TEXT NOT NULL, PRIMARY KEY(member,id));
      CREATE TABLE operations (member TEXT, id TEXT, hash TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(member,id));
      CREATE TRIGGER snapshots_immutable BEFORE UPDATE OF files,hash,revision,usage,at ON submissions BEGIN SELECT RAISE(ABORT,'Snapshots are immutable'); END;
      PRAGMA user_version=1; COMMIT;`);
    if(version<2)this.db.exec('BEGIN IMMEDIATE; CREATE TABLE join_bindings (member TEXT PRIMARY KEY, hash TEXT NOT NULL); PRAGMA user_version=2; COMMIT;');
    if(version<3)this.db.exec('BEGIN IMMEDIATE; CREATE TABLE grading_provenance (submission TEXT PRIMARY KEY, provenance TEXT NOT NULL); PRAGMA user_version=3; COMMIT;');
    this.db.prepare("UPDATE submissions SET state='queued' WHERE state='grading'").run();
    this.db.prepare("UPDATE operations SET status='interrupted' WHERE status='running'").run();
  }
  freezeTask(lab:string, task:{public:LabTaskBundle;hidden:LabFile[]}):void {
    this.db.prepare('INSERT INTO tasks VALUES (?,?,?)').run(lab,JSON.stringify(task.public),JSON.stringify(task.hidden));
  }
  task(lab:string):LabTaskBundle {
    const row=this.db.prepare('SELECT public FROM tasks WHERE lab=?').get(lab);
    if(!row)throw Error('Lab task delivery is not configured'); return JSON.parse(String(row.public));
  }
  hasTask(lab:string):boolean{return !!this.db.prepare('SELECT 1 FROM tasks WHERE lab=?').get(lab);}
  binding(member:string):string|undefined{return this.db.prepare('SELECT hash FROM join_bindings WHERE member=?').get(member)?.hash as string|undefined;}
  bind(member:string,hash:string):void{this.db.prepare('INSERT INTO join_bindings VALUES (?,?)').run(member,hash);}
  mirror(member:string,lab:string):LabMirror {
    if(!this.db.prepare('SELECT 1 FROM mirrors WHERE member=?').get(member)) {
      const files=this.task(lab).files;
      this.db.prepare('INSERT INTO mirrors VALUES (?,?,0,?,?)').run(member,lab,labFilesHash(files),JSON.stringify(files));
    }
    const row=this.db.prepare('SELECT * FROM mirrors WHERE member=? AND lab=?').get(member,lab)!;
    return {revision:Number(row.revision),hash:String(row.hash),files:JSON.parse(String(row.files))};
  }
  sync(member:string,lab:string,input:unknown,requireOpen:()=>void):{revision:number;hash:string} {
    const request=labSyncSchema.parse(input),files=validateLabFiles(request.files),bodyHash=createHash('sha256').update(JSON.stringify({...request,files})).digest('hex');
    const prior=this.db.prepare('SELECT * FROM syncs WHERE member=? AND id=?').get(member,request.requestId);
    if(prior){if(prior.body_hash!==bodyHash)throw Error('Sync request ID reuse conflict');return JSON.parse(String(prior.ack));}
    requireOpen();const mirror=this.mirror(member,lab);
    if(request.baseRevision!==mirror.revision)throw Error('Lab mirror revision conflict; reconnect before editing');
    const hash=labFilesHash(files),ack={revision:mirror.revision+1,hash};
    this.db.exec('BEGIN IMMEDIATE');try{
      this.db.prepare('UPDATE mirrors SET revision=?,hash=?,files=? WHERE member=?').run(ack.revision,hash,JSON.stringify(files),member);
      this.db.prepare('INSERT INTO syncs VALUES (?,?,?,?)').run(member,request.requestId,bodyHash,JSON.stringify(ack));this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}return ack;
  }
  submit(member:string,lab:string,input:unknown,usage:Omit<PracticeReport,'schema'|'kind'|'taskId'|'submittedAt'|'correctness'>,now:string,requireOpen:()=>void=()=>{}):LabSubmission {
    const request=labSubmitSchema.parse(input),prior=this.db.prepare('SELECT * FROM submits WHERE member=? AND id=?').get(member,request.requestId);
    if(prior){if(Number(prior.revision)!==request.revision)throw Error('Submission request ID reuse conflict');return receipt(this.db.prepare('SELECT * FROM submissions WHERE id=?').get(String(prior.submission)) as SubmissionRow);}
    requireOpen();const mirror=this.mirror(member,lab);if(request.revision!==mirror.revision)throw Error('Submission revision conflict');
    const number=Number(this.db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE member=?').get(member)!.n)+1,id=randomUUID();
    this.db.exec('BEGIN IMMEDIATE');try{
      this.db.prepare("INSERT INTO submissions VALUES (?,?,?,?,?,?,?,'queued',NULL,NULL,?,?)").run(id,member,lab,number,mirror.revision,mirror.hash,now,JSON.stringify(mirror.files),JSON.stringify(usage));
      this.db.prepare('INSERT INTO submits VALUES (?,?,?,?)').run(member,request.requestId,mirror.revision,id);this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}return this.submissions(member).at(-1)!;
  }
  autoSubmit(member:string,lab:string,usage:Parameters<LabArtifacts['submit']>[3],now:string):void {
    const mirror=this.mirror(member,lab),last=this.submissions(member).at(-1);
    if(!last||last.snapshotHash!==mirror.hash)this.submit(member,lab,{requestId:`close-${mirror.revision}`,revision:mirror.revision},usage,now);
  }
  submissions(member:string):LabSubmission[]{return(this.db.prepare('SELECT * FROM submissions WHERE member=? ORDER BY number').all(member)as SubmissionRow[]).map(receipt);}
  claim():GradeSnapshot|undefined {
    const row=this.db.prepare("SELECT * FROM submissions WHERE state='queued' ORDER BY rowid LIMIT 1").get() as SubmissionRow|undefined;if(!row)return;
    this.db.prepare("UPDATE submissions SET state='grading' WHERE id=? AND state='queued'").run(row.id);
    const task=this.db.prepare('SELECT * FROM tasks WHERE lab=?').get(row.lab)!;
    return {id:row.id,lab:row.lab,member:row.member,files:JSON.parse(row.files),hidden:JSON.parse(String(task.hidden)),task:JSON.parse(String(task.public)).task};
  }
  retryFailed(lab:string):number{return Number(this.db.prepare("UPDATE submissions SET state='queued' WHERE lab=? AND state='failed' AND released_at IS NULL").run(lab).changes);}
  provenance(id:string):GradingProvenance|undefined {const row=this.db.prepare('SELECT provenance FROM grading_provenance WHERE submission=?').get(id);return row?gradingProvenanceSchema.parse(JSON.parse(String(row.provenance))):undefined;}
  graderImage(lab:string):string|undefined {const row=this.db.prepare('SELECT p.provenance FROM grading_provenance p JOIN submissions s ON s.id=p.submission WHERE s.lab=? ORDER BY s.rowid LIMIT 1').get(lab);return row?gradingProvenanceSchema.parse(JSON.parse(String(row.provenance))).image:undefined;}
  assertGraderImage(lab:string,image:string):void{const pinned=this.graderImage(lab);if(pinned&&pinned!==image)throw Error('The grading image is pinned for this lab. Restore its original image to retry.');}
  graded(snapshot:GradeSnapshot,result:LabGradeVerdict):void {
    const row=this.db.prepare('SELECT * FROM submissions WHERE id=?').get(snapshot.id)as SubmissionRow;
    const report=practiceReportSchema.parse({schema:1,kind:'practice',taskId:snapshot.task.id,submittedAt:row.at,correctness:{passed:result.passed,total:result.total},
      ...JSON.parse(row.usage),checks:result.checks?.map(check=>({name:check.name,passed:check.passed,...(!check.passed?{message:'This hidden check did not pass.'}:{})}))});
    if(result.provenance)gradingProvenanceSchema.parse(result.provenance);
    this.db.exec('BEGIN IMMEDIATE');try{
      if(result.provenance){this.assertGraderImage(snapshot.lab,result.provenance.image);this.db.prepare('INSERT OR REPLACE INTO grading_provenance VALUES (?,?)').run(snapshot.id,JSON.stringify(result.provenance));}
      this.db.prepare("UPDATE submissions SET state='graded',report=? WHERE id=?").run(JSON.stringify(report),snapshot.id);this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  failed(id:string):void{this.db.prepare("UPDATE submissions SET state='failed' WHERE id=?").run(id);}
  release(lab:string,at:string):void {
    const rows=this.db.prepare('SELECT * FROM submissions WHERE lab=?').all(lab)as SubmissionRow[];
    if(!rows.length||rows.some(row=>row.state!=='graded'))throw Error('Grading is pending or failed');
    this.db.prepare('UPDATE submissions SET released_at=COALESCE(released_at,?) WHERE lab=?').run(at,lab);
  }
  reports(member:string,studentId:string):PracticeReport[]{return(this.db.prepare('SELECT * FROM submissions WHERE member=? AND released_at IS NOT NULL ORDER BY number').all(member)as SubmissionRow[])
    .map(row=>practiceReportSchema.parse({...JSON.parse(row.report!),lab:{id:row.lab,studentId,submissionId:row.id,snapshotHash:row.hash,revision:row.revision,releasedAt:row.released_at}}));}
  event(member:string,input:unknown):void {const event=labClientEventSchema.parse(input);this.db.prepare('INSERT OR IGNORE INTO client_events VALUES (?,?,?)').run(member,event.id,JSON.stringify(event));}
  events(member:string):unknown[]{return this.db.prepare('SELECT event FROM client_events WHERE member=? ORDER BY rowid').all(member).map(row=>JSON.parse(String(row.event)));}
  operation(member:string,id:string,prompt:string):'new'|'running'|'complete'|'interrupted' {
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error('Invalid prompt request ID');
    const hash=createHash('sha256').update(prompt).digest('hex'),row=this.db.prepare('SELECT * FROM operations WHERE member=? AND id=?').get(member,id);
    if(row){if(row.hash!==hash)throw Error('Prompt request ID reuse conflict');return row.status as 'running'|'complete'|'interrupted';}
    this.db.prepare("INSERT INTO operations VALUES (?,?,?,'running')").run(member,id,hash);return'new';
  }
  complete(member:string,id:string):void{this.db.prepare("UPDATE operations SET status='complete' WHERE member=? AND id=?").run(member,id);}
  close():void{this.db.close();}
}
