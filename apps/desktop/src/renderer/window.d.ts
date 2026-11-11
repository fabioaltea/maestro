import type { DesktopApi } from '../shared/bridge-contract.ts';
declare global { interface Window { maestro: DesktopApi } }
