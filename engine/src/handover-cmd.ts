// `req handover <需求> <接手人> [--note <说明>] [--repo <目录>]` (X5):
// transfers ownership of a requirement to another colleague and records `.pipeline/owner.json`.
import path from "node:path";
import { locate } from "./api.js";
import { handover } from "./handover.js";

function main(argvIn: string[]): number {
  if (argvIn.includes("--help") || argvIn.includes("-h")) {
    console.log("用法：laoshi handover <需求> <接手人> [--note <说明>] [--repo <目录>]");
    return 0;
  }
  const argv = [...argvIn];
  let repoArg = process.cwd();
  let note: string | null = null;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--note" && argv[i + 1] !== undefined) note = argv[++i];
    else if (a.startsWith("--note=")) note = a.slice(7);
    else if (a === "--repo" && argv[i + 1] !== undefined) repoArg = path.resolve(argv[++i]);
    else if (a.startsWith("--repo=")) repoArg = path.resolve(a.slice(7));
    else if (!a.startsWith("-")) positional.push(a);
    else {
      console.error(`未知选项：${a}`);
      return 2;
    }
  }

  const [feature, to] = positional;
  if (!feature || !to || positional.length > 2) {
    console.error("用法：laoshi handover <需求> <接手人> [--note <说明>]");
    return 2;
  }

  const { repo, featureDir } = locate(repoArg, feature);
  const record = handover(path.join(repo, featureDir), { to, note });
  console.log(`已把 ${featureDir} 转给 ${record.owner}${note?.trim() ? `（说明：${note.trim()}）` : ""}`);
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  console.error(`转交失败：${(error as Error).message}`);
  process.exit(1);
}
