import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { labCreateSchema, labJoinRequestSchema, labJoinResponseSchema, labOverviewSchema, labStudentStateSchema, tokenUsageSchema,
  labGradingStatusSchema,type LabCreate, type LabOverview, type LabJoinResponse, type LabStudentState, type TokenUsage } from '@factoryze/protocol';
import { UsageStore } from '#usage-store';
import { FACTORYZE_PROFILE } from '#harness';
import { LabArtifacts, type LabGrader } from './lab-artifacts.ts';
import { captureLabTask } from './lab-files.ts';
import type { Reconciliation, PracticeReport } from '@factoryze/protocol';

export class LabError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const digest = (purpose: string, value: string) => createHash('sha256').update(`${purpose}\0${value}`).digest('hex');
type LabRow = { id: string; configuration: string; code_hash: string; created_at: string; closes_at: string; closed_at: string | null };
type Member = { id: string; lab_id: string; student_id: string; account_id: string; expires_at: string };

/** Server-owned lab lifecycle. No student-reported usage or provider credentials enter this store. */
export class LabEngine {
  private readonly db: DatabaseSync;
  private readonly ledger: UsageStore;
  private readonly now: () => number;
  private readonly active = new Map<string, Set<AbortController>>();
  readonly artifacts: LabArtifacts;
  private readonly taskRoot?: string;
  private readonly sessionSeed:Buffer;
  constructor(directory: string, options: { now?: () => number; taskRoot?: string } = {}) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const seed=join(directory,'session-seed');if(!existsSync(seed))writeFileSync(seed,randomBytes(32),{flag:'wx',mode:0o600});
    if(lstatSync(seed).isSymbolicLink())throw Error('Invalid lab session seed');
    this.sessionSeed=readFileSync(seed);if(this.sessionSeed.length!==32)throw Error('Invalid lab session seed');
    this.now = options.now ?? Date.now;
    this.taskRoot = options.taskRoot;
    this.db = new DatabaseSync(join(directory, 'labs.sqlite'));
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    const version = this.db.prepare('PRAGMA user_version').get()!.user_version;
    if (version !== 0 && version !== 1) { this.db.close(); throw Error('Unsupported lab database version'); }
    if (version === 0) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE labs (id TEXT PRIMARY KEY, configuration TEXT NOT NULL, code_hash TEXT NOT NULL,
        created_at TEXT NOT NULL, closes_at TEXT NOT NULL, closed_at TEXT);
      CREATE TABLE students (id TEXT PRIMARY KEY, lab_id TEXT NOT NULL REFERENCES labs(id), student_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL, expires_at TEXT NOT NULL, UNIQUE(lab_id,student_id));
      PRAGMA user_version=1; COMMIT;`);
    try { this.ledger = new UsageStore(join(directory, 'usage.sqlite')); }
    catch (error) { this.db.close(); throw error; }
    this.artifacts = new LabArtifacts(join(directory,'artifacts.sqlite'));
  }
  create(input: unknown): { code: string; lab: LabOverview } {
    const parsed = labCreateSchema.safeParse(input);
    if (!parsed.success) throw new LabError(400, 'Invalid lab configuration or roster; temperature must be zero');
    const value = parsed.data;
    if (value.config.agent.profile !== FACTORYZE_PROFILE) throw new LabError(400, 'Unsupported lab agent profile');
    if (value.config.agent.permissions.edit !== 'ask' || value.config.agent.permissions.shell !== 'ask')
      throw new LabError(400, 'Lab edits and commands must require approval');
    if (this.db.prepare('SELECT 1 FROM labs WHERE id=?').get(value.config.lab)) throw new LabError(409, 'Lab already exists');
    const task = this.taskRoot ? captureLabTask(this.taskRoot,value.config.task) : undefined;
    const code = randomBytes(12).toString('base64url'), now = this.now();
    this.db.prepare('INSERT INTO labs VALUES (?,?,?,?,?,NULL)').run(value.config.lab, JSON.stringify(value), digest('join', code),
      new Date(now).toISOString(), new Date(now + value.config.timeLimitMinutes * 60_000).toISOString());
    if(task)this.artifacts.freezeTask(value.config.lab,task);
    return { code, lab: this.overview(value.config.lab) };
  }
  private row(id: string): LabRow {
    const row = this.db.prepare('SELECT * FROM labs WHERE id=?').get(id) as LabRow | undefined;
    if (!row) throw new LabError(404, 'Lab not found');
    if (!row.closed_at && this.now() >= Date.parse(row.closes_at)) this.closeLab(id, row.closes_at);
    return this.db.prepare('SELECT * FROM labs WHERE id=?').get(id) as LabRow;
  }
  private requireOpen(row: LabRow): void { if (row.closed_at) throw new LabError(409, 'Lab is closed'); }
  join(input: unknown): LabJoinResponse {
    const parsed = labJoinRequestSchema.safeParse(input);
    if (!parsed.success) throw new LabError(400, 'Invalid lab join request or protocol version');
    const value = parsed.data;
    // Uniform denial for unknown lab, wrong code and students outside the roster.
    const existing = this.db.prepare('SELECT * FROM labs WHERE id=?').get(value.lab) as LabRow | undefined;
    if (!existing || !timingSafeEqual(Buffer.from(existing.code_hash, 'hex'), Buffer.from(digest('join', value.code), 'hex')))
      throw new LabError(401, 'Invalid lab join credentials');
    const row = this.row(value.lab), definition: LabCreate = JSON.parse(row.configuration);
    if (!definition.roster.includes(value.studentId)) throw new LabError(401, 'Invalid lab join credentials');
    if (value.profile !== definition.config.agent.profile) throw new LabError(409, 'Client agent profile does not match the lab');
    const previous=this.db.prepare('SELECT * FROM students WHERE lab_id=? AND student_id=?').get(value.lab,value.studentId)as (Member&{token_hash:string})|undefined;
    const derived=value.binding?createHmac('sha256',this.sessionSeed).update(JSON.stringify([value.lab,value.studentId,value.binding])).digest('base64url'):undefined;
    if(previous&&derived&&this.artifacts.binding(previous.id)===digest('binding',value.binding!)&&previous.token_hash===digest('session',derived))
      return labJoinResponseSchema.parse({protocol:1,token:derived,expiresAt:previous.expires_at,state:this.student(derived)});
    this.requireOpen(row);
    if (previous)
      throw new LabError(409, 'Student already joined; reconnect with the saved session');
    const token = derived??randomBytes(32).toString('base64url'), id = randomUUID();
    const expiresAt = new Date(Date.parse(row.closes_at) + 24 * 60 * 60_000).toISOString();
    const account = this.ledger.account({ userId: id, taskId: definition.config.task,
      profile: definition.config.agent.profile, model: definition.config.agent.model }, definition.config.budget);
    this.db.prepare('INSERT INTO students VALUES (?,?,?,?,?,?)').run(id, value.lab, value.studentId, digest('session', token), account, expiresAt);
    if(value.binding)this.artifacts.bind(id,digest('binding',value.binding));
    this.ensureWorkspace({id,lab_id:value.lab,student_id:value.studentId,account_id:account,expires_at:expiresAt},definition);
    return labJoinResponseSchema.parse({ protocol: 1, token, expiresAt, state: this.student(token) });
  }
  private member(token: string): Member {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new LabError(401, 'Invalid lab session');
    const member = this.db.prepare('SELECT * FROM students WHERE token_hash=?').get(digest('session', token)) as Member | undefined;
    if (!member || Date.parse(member.expires_at) <= this.now()) throw new LabError(401, 'Lab session is invalid or expired');
    return member;
  }
  private ensureWorkspace(member:Member,definition:LabCreate):string {
    const workspace=`lab:${member.lab_id}:${member.id}`;
    try{this.ledger.workspace(workspace,member.id);}catch{this.ledger.registerWorkspace(workspace,member.id,definition.config.task);}
    return workspace;
  }
  /** Internal, server-only account context. Never return this object over an API. */
  access(token:string) {
    const member=this.member(token),row=this.row(member.lab_id),definition:LabCreate=JSON.parse(row.configuration);
    return {...member,definition,closed:!!row.closed_at,workspace:this.ensureWorkspace(member,definition),store:this.ledger};
  }
  assertOpen(token:string):void{const member=this.member(token);this.requireOpen(this.row(member.lab_id));}
  task(token:string){const member=this.member(token);return this.artifacts.task(member.lab_id);}
  mirror(token:string){const member=this.member(token);return this.artifacts.mirror(member.id,member.lab_id);}
  sync(token:string,input:unknown){const member=this.member(token);return this.artifacts.sync(member.id,member.lab_id,input,()=>this.requireOpen(this.row(member.lab_id)));}
  private submissionUsage(member:Member):Omit<PracticeReport,'schema'|'kind'|'taskId'|'submittedAt'|'correctness'> {
    const definition:LabCreate=JSON.parse((this.db.prepare('SELECT configuration FROM labs WHERE id=?').get(member.lab_id)!).configuration as string);
    const workspace=this.ensureWorkspace(member,definition);
    return {usage:[this.ledger.totals(member.account_id)],workspaceUsage:this.ledger.workspaceUsage(workspace,member.id),
      insights:this.ledger.reportInsights(workspace,member.id),executionPins:[{profile:definition.config.agent.profile,model:definition.config.agent.model,
        providerHost:definition.providerHost,temperature:0,os:process.platform as 'win32'|'linux'|'darwin'}]};
  }
  submit(token:string,input:unknown){const member=this.member(token);return this.artifacts.submit(member.id,member.lab_id,input,this.submissionUsage(member),new Date(this.now()).toISOString(),()=>this.requireOpen(this.row(member.lab_id)));}
  submissions(token:string){return this.artifacts.submissions(this.member(token).id);}
  releasedReports(token:string){const member=this.member(token);return this.artifacts.reports(member.id,member.student_id);}
  retryGrades(lab:string):number{this.row(lab);return this.artifacts.retryFailed(lab);}
  gradingStatus(lab:string){this.row(lab);return labGradingStatusSchema.parse({protocol:1,lab,
    submissions:(this.db.prepare('SELECT * FROM students WHERE lab_id=? ORDER BY student_id').all(lab)as Member[]).flatMap(member=>
      this.artifacts.submissions(member.id).map(submission=>({...submission,studentId:member.student_id,...(this.artifacts.provenance(submission.id)?{provenance:this.artifacts.provenance(submission.id)}:{})})))});}
  async gradeQueued(grader:LabGrader){
    let graded=0,failed=0;for(;;){const snapshot=this.artifacts.claim();if(!snapshot)break;try{if(grader.image)this.artifacts.assertGraderImage(snapshot.lab,grader.image);this.artifacts.graded(snapshot,await grader(snapshot));graded++;}catch{this.artifacts.failed(snapshot.id);failed++;}}
    return {graded,failed};
  }
  release(lab:string):LabOverview{if(!this.row(lab).closed_at)throw new LabError(409,'Close the lab before releasing reports');this.artifacts.release(lab,new Date(this.now()).toISOString());return this.overview(lab);}
  recordClientEvent(token:string,input:unknown){this.artifacts.event(this.member(token).id,input);}
  integrity(lab:string){this.row(lab);return(this.db.prepare('SELECT * FROM students WHERE lab_id=? ORDER BY student_id').all(lab)as Member[]).map(member=>({studentId:member.student_id,trusted:false,events:this.artifacts.events(member.id)}));}
  resetStudent(lab:string,studentId:string){
    this.row(lab);const member=this.db.prepare('SELECT * FROM students WHERE lab_id=? AND student_id=?').get(lab,studentId)as Member|undefined;
    if(!member)throw new LabError(404,'Student has not joined');
    const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Math.max(Date.parse(member.expires_at),this.now()+86400000)).toISOString();
    this.db.prepare('UPDATE students SET token_hash=?,expires_at=? WHERE id=?').run(digest('session',token),expiresAt,member.id);
    return {token,expiresAt,state:this.student(token)};
  }
  reconcileStudent(lab:string,studentId:string,input:Reconciliation){
    const member=this.db.prepare('SELECT * FROM students WHERE lab_id=? AND student_id=?').get(lab,studentId)as Member|undefined;
    if(!member)throw new LabError(404,'Student has not joined');const definition:LabCreate=JSON.parse(this.row(lab).configuration);
    this.ledger.reconcile(this.ensureWorkspace(member,definition),member.id,input);
  }
  student(token: string): LabStudentState {
    const member = this.member(token), row = this.row(member.lab_id), definition: LabCreate = JSON.parse(row.configuration);
    return labStudentStateSchema.parse({ protocol: 1, lab: row.id, studentId: member.student_id, task: definition.config.task,
      profile: definition.config.agent.profile, model: definition.config.agent.model, providerHost: definition.providerHost,
      temperature: 0, permissions: definition.config.agent.permissions, state: row.closed_at ? 'closed' : 'open',
      closesAt: row.closes_at, closedAt: row.closed_at, usage: this.ledger.totals(member.account_id) });
  }
  /** Internal seam for the future server harness; never exposed as a client usage API. */
  async metered<T>(token: string, work: (signal: AbortSignal) => Promise<{ value: T; usage: TokenUsage }>): Promise<T> {
    const member = this.member(token);
    return this.ledger.exclusive(member.account_id, async () => {
      this.member(token); this.requireOpen(this.row(member.lab_id));
      const request = this.ledger.begin(member.account_id), controller = new AbortController();
      const controllers = this.active.get(member.lab_id) ?? new Set<AbortController>();
      this.active.set(member.lab_id, controllers); controllers.add(controller);
      try {
        const result = await work(controller.signal);
        this.ledger.finish(request, tokenUsageSchema.parse(result.usage), true);
        controller.signal.throwIfAborted();
        return result.value;
      } catch (error) { this.ledger.finish(request, undefined, false); throw error; }
      finally { controllers.delete(controller); if (!controllers.size) this.active.delete(member.lab_id); }
    });
  }
  closeLab(id: string, at = new Date(this.now()).toISOString()): LabOverview {
    if (!this.db.prepare('SELECT 1 FROM labs WHERE id=?').get(id)) throw new LabError(404, 'Lab not found');
    this.db.prepare('UPDATE labs SET closed_at=COALESCE(closed_at,?) WHERE id=?').run(at, id);
    if(this.artifacts.hasTask(id))for(const member of this.db.prepare('SELECT * FROM students WHERE lab_id=?').all(id)as Member[])
      this.artifacts.autoSubmit(member.id,id,this.submissionUsage(member),at);
    for (const controller of this.active.get(id) ?? []) controller.abort(new LabError(409, 'Lab is closed'));
    return this.overview(id);
  }
  closeExpired(): void {
    for (const row of this.db.prepare('SELECT id,closes_at FROM labs WHERE closed_at IS NULL AND closes_at<=?').all(new Date(this.now()).toISOString()))
      this.closeLab(String(row.id), String(row.closes_at));
  }
  overview(id: string): LabOverview {
    const row = this.row(id), definition: LabCreate = JSON.parse(row.configuration);
    const members = this.db.prepare('SELECT * FROM students WHERE lab_id=?').all(id) as Member[];
    return labOverviewSchema.parse({ protocol: 1, config: definition.config, providerHost: definition.providerHost, temperature: 0,
      createdAt: row.created_at, closesAt: row.closes_at, closedAt: row.closed_at,
      students: definition.roster.map(studentId => {
        const member = members.find(entry => entry.student_id === studentId);
        return { studentId, joined: !!member, usage: member ? this.ledger.totals(member.account_id) : null };
      }) });
  }
  exportCsv(id: string): string {
    const lab = this.overview(id);
    const cell = (value: unknown) => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
    return [['lab', 'student_id', 'joined', 'profile', 'model', 'weighted_tokens', 'remaining_tokens', 'accounting_status', 'lab_state','correctness_passed','correctness_total','submission_hash','grading_executor','grading_image','grading_python'],
      ...lab.students.map(student => [id, student.studentId, student.joined, lab.config.agent.profile, lab.config.agent.model,
        student.usage?.weighted ?? '', student.usage?.remaining ?? '', student.usage?.status ?? 'not_joined', lab.closedAt ? 'closed' : 'open',...this.csvGrade(id,student.studentId)])]
      .map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  private csvGrade(lab:string,studentId:string):unknown[]{const member=this.db.prepare('SELECT * FROM students WHERE lab_id=? AND student_id=?').get(lab,studentId)as Member|undefined;
    const report=member?this.artifacts.reports(member.id,studentId).at(-1):undefined,grading=report?.lab?this.artifacts.provenance(report.lab.submissionId):undefined;
    return[report?.correctness.passed??'',report?.correctness.total??'',report?.lab?.snapshotHash??'',grading?.executor??'',grading?.image??'',grading?.python??''];}
  close(): void {
    for (const controllers of this.active.values()) for (const controller of controllers) controller.abort(new Error('Lab server stopped'));
    this.artifacts.close();this.ledger.close(); this.db.close();
  }
}
