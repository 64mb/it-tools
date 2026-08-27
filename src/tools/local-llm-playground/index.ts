import { Robot } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const registry = {
  category: 'Text',
  order: 11,
} as const satisfies import('../tools.types').ToolRegistryMetadata;

export const tool = defineTool({
  name: translate('tools.local-llm-playground.title'),
  path: '/local-llm-playground',
  description: translate('tools.local-llm-playground.description'),
  keywords: ['local llm', 'qwen', 'qwen3.5', 'webgpu', 'ai', 'chat', 'text generation', 'offline model'],
  component: () => import('./local-llm-playground.vue'),
  icon: Robot,
  createdAt: new Date('2026-08-25'),
});
