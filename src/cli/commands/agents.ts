import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot, projectPathsFor } from '../../utils/paths.js';
import { readMarkdown } from '../../utils/markdown.js';
import { AgentFrontmatterSchema } from '../../schemas/agent-frontmatter.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';

export async function runAgents(): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = projectPathsFor(root);

  if (!existsSync(paths.agents)) {
    console.log('[maestro] No .agents/ directory found.');
    return;
  }

  const entries = readdirSync(paths.agents, { withFileTypes: true });
  const agentFiles = entries.filter(
    (e) => e.isFile() && e.name.endsWith('.md'),
  );

  if (agentFiles.length === 0) {
    console.log('[maestro] No agent files found in .agents/');
    return;
  }

  console.log('');
  for (const entry of agentFiles) {
    const filePath = join(paths.agents, entry.name);
    try {
      const { data } = readMarkdown(filePath);
      // gray-matter parses YAML dates as Date objects; coerce to string
      if (data['created'] instanceof Date) data['created'] = (data['created'] as Date).toISOString();
      const fm = AgentFrontmatterSchema.safeParse(data);
      const name = fm.success ? fm.data.name : entry.name.replace('.md', '');
      const model = fm.success ? fm.data.model : DIM + 'unknown' + RESET;
      const mode = fm.success ? fm.data.mode : 'unknown';
      const skills = fm.success && fm.data.skills.length ? fm.data.skills.join(', ') : DIM + 'none' + RESET;
      const seniority = fm.success ? fm.data.seniority : 'mid';
      console.log(`  ${BOLD}${CYAN}${name}${RESET}`);
      console.log(`    model: ${model}  mode: ${mode}  seniority: ${seniority}`);
      console.log(`    skills: ${skills}`);
    } catch {
      console.log(`  ${entry.name}`);
    }
  }
  console.log('');
}
