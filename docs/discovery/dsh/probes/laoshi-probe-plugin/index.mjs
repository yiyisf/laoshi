// Probe plugin: can a laoshi plugin inside the dsh host reach the services Paseo gives req-kit?
// - reports which host services exist
// - answers tool approvals by policy: allow while <allowFile> exists, otherwise defer to the UI
// - takes commands from <inbox>/<id>.json and writes the outcome to <outbox>/<id>.json:
//     { op: "spawn", parent, label, prompt, cwd }       child agent under a session
//     { op: "schedule", sessionId, title, prompt, after_seconds }
import fs from 'node:fs';
import path from 'node:path';

export const name = 'laoshi-probe';
export const inject = ['agents', 'subagents', 'schedule', 'approval'];

export function apply(ctx, config) {
  const log = (o) => fs.appendFileSync(config.log, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');
  const outbox = config.outbox ?? config.inbox;
  const reply = (id, o) => fs.writeFileSync(path.join(outbox, `${id}.json`), JSON.stringify({ at: new Date().toISOString(), ...o }));
  const services = Object.fromEntries(['agents', 'subagents', 'schedule', 'approval', 'sessions', 'jobs', 'worktrees'].map((k) => [k, !!ctx.get(k)]));
  log({ loaded: true, services, subagentProviders: ctx.get('subagents')?.list?.() ?? null });

  // Prepend: the Web gateway's answerer forwards to the browser and does not call next().
  ctx.on('approval/request', async (req, next) => {
    const allow = fs.existsSync(config.allowFile);
    log({ approval: { tool: req.toolName, reason: req.reason ?? null, agent: req.agent?.id ?? null }, decision: allow ? 'allowed-once' : 'defer' });
    return allow ? 'allowed-once' : next();
  }, { prepend: true });

  const handle = async (id, op) => {
    if (op.op === 'spawn') {
      let parent = ctx.agents.get(op.parent);
      const live = !!parent;
      if (!parent) {
        try {
          parent = (await ctx.agents.resume({ sessionId: op.parent }))?.agent ?? null;
        } catch (e) {
          log({ spawn: 'resume-failed', error: String(e?.message ?? e) });
        }
      }
      if (!parent) return reply(id, { ok: false, error: 'parent session is not live and could not be resumed', live });
      const provider = op.provider ?? ctx.subagents.list()[0];
      const act = await ctx.subagents.startActivation({
        provider,
        label: op.label,
        request: { prompt: [{ type: 'text', text: op.prompt }], parent, cwd: op.cwd },
        signal: new AbortController().signal,
        delivery: 'caller',
      });
      log({ spawn: 'started', provider, childId: act.childId, parentWasLive: live });
      try {
        const result = await act.result;
        reply(id, { ok: true, provider, parentWasLive: live, childId: act.childId, result });
      } catch (e) {
        reply(id, { ok: false, provider, childId: act.childId, error: String(e?.message ?? e) });
      }
    } else if (op.op === 'schedule') {
      const record = await ctx.schedule.create(op.sessionId, { prompt: op.prompt, title: op.title, after_seconds: op.after_seconds });
      reply(id, { ok: true, record });
    } else {
      reply(id, { ok: false, error: `unknown op ${op.op}` });
    }
  };

  const timer = setInterval(() => {
    for (const f of fs.existsSync(config.inbox) ? fs.readdirSync(config.inbox) : []) {
      if (!f.endsWith('.json')) continue;
      const file = path.join(config.inbox, f);
      const id = f.slice(0, -'.json'.length);
      let op;
      try {
        op = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        continue; // still being written
      }
      fs.renameSync(file, file + '.taken');
      handle(id, op).catch((e) => {
        log({ op: op.op, error: String(e?.stack ?? e).slice(0, 600) });
        reply(id, { ok: false, error: String(e?.message ?? e) });
      });
    }
  }, 500);
  ctx.on('dispose', () => clearInterval(timer));
}
