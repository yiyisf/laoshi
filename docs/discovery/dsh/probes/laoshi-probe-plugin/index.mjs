// Probe plugin: can a laoshi plugin inside the dsh host reach the services Paseo gives req-kit?
// - reports which host services exist
// - answers tool approvals by policy (allow while <allowFile> exists, otherwise defer to the UI)
// - takes commands from an inbox directory: spawn a child agent under a session, create a schedule
import fs from 'node:fs';
import path from 'node:path';

export const name = 'laoshi-probe';
export const inject = ['agents', 'subagents', 'schedule', 'approval'];

export function apply(ctx, config) {
  const log = (o) => fs.appendFileSync(config.log, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');
  const services = Object.fromEntries(['agents', 'subagents', 'schedule', 'approval', 'sessions', 'jobs', 'worktrees'].map((k) => [k, !!ctx.get(k)]));
  log({ loaded: true, services, subagentProviders: ctx.get('subagents')?.list?.() ?? null });

  ctx.on('approval/request', async (req, next) => {
    const allow = fs.existsSync(config.allowFile);
    log({ approval: { tool: req.toolName, reason: req.reason ?? null, agent: req.agent?.id ?? null }, decision: allow ? 'allowed-once' : 'defer' });
    return allow ? 'allowed-once' : next();
  }, { prepend: true });

  const handle = async (op) => {
    if (op.op === 'spawn') {
      let parent = ctx.agents.get(op.parent);
      log({ spawn: 'parent-lookup', live: !!parent });
      if (!parent) {
        try { parent = (await ctx.agents.resume({ sessionId: op.parent })).agent ?? null; } catch (e) { log({ spawn: 'resume-failed', error: String(e?.message ?? e) }); }
      }
      if (!parent) return;
      const provider = op.provider ?? ctx.subagents.list()[0];
      const act = await ctx.subagents.startActivation({
        provider, label: op.label,
        request: { prompt: [{ type: 'text', text: op.prompt }], parent, cwd: op.cwd },
        signal: new AbortController().signal, delivery: 'caller',
      });
      log({ spawn: 'started', provider, childId: act.childId });
      act.result.then((r) => log({ spawn: 'result', childId: act.childId, result: JSON.stringify(r).slice(0, 400) }), (e) => log({ spawn: 'result-error', error: String(e?.message ?? e) }));
    } else if (op.op === 'schedule') {
      const rec = await ctx.schedule.create(op.sessionId, { prompt: op.prompt, title: op.title, after_seconds: op.after_seconds });
      log({ schedule: 'created', record: JSON.stringify(rec).slice(0, 300) });
    }
  };

  const timer = setInterval(() => {
    for (const f of fs.existsSync(config.inbox) ? fs.readdirSync(config.inbox) : []) {
      if (!f.endsWith('.json')) continue;
      const file = path.join(config.inbox, f);
      const op = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.renameSync(file, file + '.taken');
      handle(op).catch((e) => log({ op: op.op, error: String(e?.stack ?? e).slice(0, 600) }));
    }
  }, 500);
  ctx.on('dispose', () => clearInterval(timer));
}
