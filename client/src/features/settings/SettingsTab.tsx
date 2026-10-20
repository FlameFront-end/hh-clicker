import { BotParams } from './BotParams';
import { Filters } from './Filters';
import { Diagnostics, JsonBackup } from './JsonBackup';
import { LlmSettings } from './LlmSettings';
import { Proxy } from './Proxy';
import { Letters, Questionnaire } from './Templates';
import { UrlPool } from './UrlPool';
import { Group } from './kit';

export function SettingsTab() {
  return (
    <div>
      <Group>Поиск и отклики</Group>
      <BotParams />
      <Filters />
      <UrlPool />
      <Group>Шаблоны</Group>
      <Letters />
      <Questionnaire />
      <Group>AI / LLM</Group>
      <LlmSettings />
      <Group>Подключение</Group>
      <Proxy />
      <Group>Продвинутое</Group>
      <JsonBackup />
      <Diagnostics />
    </div>
  );
}
