const NO_COLOR = !process.stdout.isTTY || process.env.NO_COLOR !== undefined;

const c = {
  reset:  NO_COLOR ? '' : '\x1b[0m',
  bold:   NO_COLOR ? '' : '\x1b[1m',
  dim:    NO_COLOR ? '' : '\x1b[2m',
  red:    NO_COLOR ? '' : '\x1b[31m',
  green:  NO_COLOR ? '' : '\x1b[32m',
  yellow: NO_COLOR ? '' : '\x1b[33m',
  cyan:   NO_COLOR ? '' : '\x1b[36m',
  gray:   NO_COLOR ? '' : '\x1b[90m',
};

const TAG = `${c.bold}${c.cyan}maestro${c.reset}`;

export const log = {
  info:  (...args: unknown[]) => console.log( `${c.gray}[${TAG}${c.gray}]${c.reset}`, ...args),
  ok:    (...args: unknown[]) => console.log( `${c.green}✓${c.reset}`, ...args),
  warn:  (...args: unknown[]) => console.warn(`${c.gray}[${TAG}${c.gray}]${c.reset} ${c.yellow}warn${c.reset}`, ...args),
  error: (...args: unknown[]) => console.error(`${c.gray}[${TAG}${c.gray}]${c.reset} ${c.red}error${c.reset}`, ...args),
  step:  (...args: unknown[]) => console.log( `${c.gray}[${TAG}${c.gray}]${c.reset} ${c.dim}→${c.reset}`, ...args),
  check: (label: string, ok: boolean, note?: string) => {
    const icon = ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    const suffix = note ? `  ${c.dim}${note}${c.reset}` : '';
    console.log(`  ${icon}  ${label}${suffix}`);
  },
  warn_check: (label: string, note?: string) => {
    const suffix = note ? `  ${c.dim}${note}${c.reset}` : '';
    console.log(`  ${c.yellow}⚠${c.reset}  ${label}${suffix}`);
  },
};
