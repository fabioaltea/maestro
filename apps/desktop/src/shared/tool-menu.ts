export const TOOL_MENU_CHANNEL = 'maestro.tool-menu.v1';

export const globalTools = {
  monitor: 'Monitoraggio Discovery',
  profiles: 'Profili agente',
  operations: 'Operazioni',
  activity: 'Attività',
  diagnostics: 'Diagnostica',
  service: 'Servizio',
} as const;

export type GlobalTool = keyof typeof globalTools;

export function isGlobalTool(value: unknown): value is GlobalTool {
  return typeof value === 'string' && Object.hasOwn(globalTools, value);
}
